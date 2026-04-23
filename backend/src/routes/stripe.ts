import { Router } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";

const router = Router();

function getStripe(): Stripe | null {
  if (!config.stripeSecretKey) return null;
  return new Stripe(config.stripeSecretKey);
}

router.get("/config", (_req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
    priceMonthly: config.stripePriceMonthly,
    priceYearly: config.stripePriceYearly,
  });
});

const checkoutSchema = z.object({
  plan: z.enum(["MONTHLY", "YEARLY"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

router.post("/checkout", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      next(new HttpError(503, "Billing unavailable"));
      return;
    }
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new HttpError(400, parsed.error.message));
      return;
    }
    const priceId =
      parsed.data.plan === "MONTHLY"
        ? config.stripePriceMonthly
        : config.stripePriceYearly;
    if (!priceId) {
      next(new HttpError(503, "Stripe prices not configured"));
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { subscription: true },
    });
    if (!user) {
      next(new HttpError(401, "Unauthorized"));
      return;
    }

    let customerId = user.subscription?.stripeCustomerId ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await prisma.subscription.update({
        where: { userId: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: parsed.data.successUrl,
      cancel_url: parsed.data.cancelUrl,
      metadata: {
        userId: user.id,
        plan: parsed.data.plan,
      },
      subscription_data: {
        metadata: {
          userId: user.id,
          plan: parsed.data.plan,
        },
      },
    });

    res.json({ url: session.url });
  } catch (e) {
    next(e);
  }
});

export default router;
