import { Router } from "express";
import { drawEntrySchema } from "@orbit/utils";
import { DEFAULT_JACKPOT_SEED_CENTS } from "../lib/drawEngine.js";
import { prisma } from "../lib/prisma.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireSubscription } from "../middleware/subscription.js";
import { HttpError } from "../middleware/errorHandler.js";

const router = Router();

function readSingleParam(param: string | string[] | undefined): string | null {
  if (typeof param === "string") return param;
  if (Array.isArray(param) && typeof param[0] === "string") return param[0];
  return null;
}

async function ensureOpenDraw(year: number, month: number) {
  const existing = await prisma.draw.findUnique({
    where: { year_month: { year, month } },
  });
  if (existing) return existing;
  return prisma.draw.create({
    data: {
      year,
      month,
      mode: "RANDOM",
      jackpotCents: DEFAULT_JACKPOT_SEED_CENTS,
      winningNumbers: [],
    },
  });
}

router.get("/current", async (_req, res, next) => {
  try {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const draw = await ensureOpenDraw(year, month);
    res.json({
      draw: {
        id: draw.id,
        year: draw.year,
        month: draw.month,
        jackpotCents: draw.jackpotCents,
        executedAt: draw.executedAt,
        entriesClosedAt: draw.entriesClosedAt,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get("/history/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const entries = await prisma.drawEntry.findMany({
      where: { userId: req.userId },
      include: { draw: true },
      orderBy: { createdAt: "desc" },
      take: 24,
    });
    const claims = await prisma.winnerClaim.findMany({
      where: { userId: req.userId },
      include: { draw: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      entries: entries.map((e) => ({
        drawId: e.drawId,
        year: e.draw.year,
        month: e.draw.month,
        numbers: e.numbers,
        executedAt: e.draw.executedAt,
        winningNumbers: e.draw.executedAt ? e.draw.winningNumbers : null,
      })),
      winnings: claims.map((c) => ({
        id: c.id,
        year: c.draw.year,
        month: c.draw.month,
        matchCount: c.matchCount,
        prizeCents: c.prizeCents,
        proofUrl: c.proofUrl,
        paymentStatus: c.paymentStatus,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/:drawId/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const drawId = readSingleParam(req.params.drawId as string | string[] | undefined);
    if (!drawId) {
      next(new HttpError(400, "Invalid draw id"));
      return;
    }
    const entry = await prisma.drawEntry.findFirst({
      where: { drawId, userId: req.userId },
    });
    res.json({
      entry: entry
        ? {
            numbers: entry.numbers,
            createdAt: entry.createdAt,
          }
        : null,
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  "/:drawId/entry",
  requireAuth,
  requireSubscription,
  async (req: AuthedRequest, res, next) => {
    try {
      const drawId = readSingleParam(req.params.drawId as string | string[] | undefined);
      if (!drawId) {
        next(new HttpError(400, "Invalid draw id"));
        return;
      }
      const parsed = drawEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        next(new HttpError(400, parsed.error.flatten().formErrors.join("; ")));
        return;
      }
      const draw = await prisma.draw.findUnique({
        where: { id: drawId },
      });
      if (!draw || draw.executedAt) {
        next(new HttpError(400, "Draw not open"));
        return;
      }
      if (draw.entriesClosedAt && draw.entriesClosedAt < new Date()) {
        next(new HttpError(400, "Entries closed"));
        return;
      }

      const entry = await prisma.drawEntry.upsert({
        where: {
          drawId_userId: {
            drawId: draw.id,
            userId: req.userId!,
          },
        },
        create: {
          drawId: draw.id,
          userId: req.userId!,
          numbers: parsed.data.numbers,
        },
        update: {
          numbers: parsed.data.numbers,
        },
      });

      res.status(201).json({
        entry: {
          id: entry.id,
          numbers: entry.numbers,
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
