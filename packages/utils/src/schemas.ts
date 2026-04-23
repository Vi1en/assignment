import { z } from "zod";
import {
  DRAW_NUMBERS_COUNT,
  SCORE_MAX,
  SCORE_MIN,
  SCORE_WINDOW,
} from "./constants.js";

export const emailSchema = z.string().email().max(255);

export const signupSchema = z.object({
  email: emailSchema,
  password: z.string().min(10).max(128),
  name: z.string().min(1).max(120),
  charityId: z.string().min(1),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const scoreCreateSchema = z.object({
  value: z.number().int().min(SCORE_MIN).max(SCORE_MAX),
  /** ISO date string YYYY-MM-DD */
  playedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const drawEntrySchema = z.object({
  numbers: z
    .array(z.number().int().min(SCORE_MIN).max(SCORE_MAX))
    .length(DRAW_NUMBERS_COUNT)
    .refine(
      (arr) => new Set(arr).size === arr.length,
      "Numbers must be unique",
    ),
});

export const drawRunSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  mode: z.enum(["RANDOM", "ALGORITHMIC"]),
});

export const winnerProofSchema = z.object({
  proofUrl: z.string().url().max(2048),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ScoreCreateInput = z.infer<typeof scoreCreateSchema>;
export type DrawEntryInput = z.infer<typeof drawEntrySchema>;
