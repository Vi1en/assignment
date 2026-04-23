import type { Request, Response } from "express";
import Stripe from "stripe";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";

function getStripe(): Stripe {
  return new Stripe(config.stripeSecretKey);
}

export async function handleStripeWebhook(req: Request, res: Response) {
  if (!config.stripeSecretKey) {
    res.status(503).send("Stripe not configured");
    return;
  }
  const stripe = getStripe();
  const sig = req.headers["stripe-signature"];
  if (!config.stripeWebhookSecret || typeof sig !== "string") {
    res.status(400).send("Missing signature");
    return;
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      config.stripeWebhookSecret,
    );
  } catch (err) {
    console.error(err);
    res.status(400).send("Webhook signature verification failed");
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (!subId) break;
        const sub = await stripe.subscriptions.retrieve(subId);
        const userId = sub.metadata?.userId ?? session.metadata?.userId;
        if (!userId) break;
        const planMeta =
          (sub.metadata?.plan as "MONTHLY" | "YEARLY" | undefined) ??
          (session.metadata?.plan as "MONTHLY" | "YEARLY" | undefined);
        await prisma.subscription.update({
          where: { userId },
          data: {
            stripeSubscriptionId: sub.id,
            stripeCustomerId:
              typeof sub.customer === "string"
                ? sub.customer
                : sub.customer?.id,
            status: mapStripeStatus(sub.status),
            ...(planMeta ? { plan: planMeta } : {}),
            currentPeriodEnd: sub.current_period_end
              ? new Date(sub.current_period_end * 1000)
              : null,
          },
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const local = await prisma.subscription.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });
        if (!local) break;
        await prisma.subscription.update({
          where: { id: local.id },
          data: {
            status:
              event.type === "customer.subscription.deleted"
                ? "CANCELLED"
                : mapStripeStatus(sub.status),
            currentPeriodEnd: sub.current_period_end
              ? new Date(sub.current_period_end * 1000)
              : null,
          },
        });
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (e) {
    console.error(e);
    res.status(500).send("Webhook handler failed");
  }
}

function mapStripeStatus(
  s: Stripe.Subscription.Status,
):
  | "ACTIVE"
  | "INACTIVE"
  | "CANCELLED"
  | "PAST_DUE" {
  switch (s) {
    case "active":
    case "trialing":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
    case "unpaid":
      return "CANCELLED";
    default:
      return "INACTIVE";
  }
}
