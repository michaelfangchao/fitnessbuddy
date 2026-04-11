/**
 * POST /api/upload — handles meal photos and Apple Health screenshots.
 * Node.js Runtime (NOT Edge) — sharp requires native Node.js bindings.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireSession, getUserDate } from "@/lib/auth";
import { anthropic as anthropicClient } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import sharp from "sharp";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4MB before resize
const MAX_DIMENSION = 1024;

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession(request);
  } catch (resp) {
    return resp as Response;
  }

  const userDate = getUserDate(request);

  const formData = await request.formData();
  const file = formData.get("image") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No image provided" }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Image too large. Please use a smaller photo." },
      { status: 413 }
    );
  }

  // Resize to max 1024px using sharp
  const buffer = Buffer.from(await file.arrayBuffer());
  let resizedBuffer: Buffer;
  try {
    resizedBuffer = await sharp(buffer)
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "Could not process image." }, { status: 400 });
  }

  const base64Image = resizedBuffer.toString("base64");

  // Send to Claude vision
  try {
    const VisionResponseSchema = z.discriminatedUnion("type", [
      z.object({
        type: z.literal("meal"),
        items: z.array(
          z.object({
            name: z.string(),
            calories: z.number(),
            protein_g: z.number(),
            carbs_g: z.number(),
            fat_g: z.number(),
          })
        ),
        is_asian_cuisine: z.boolean(),
        ai_confidence: z.number().min(0).max(1),
        meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
      }),
      z.object({
        type: z.literal("weight"),
        value_kg: z.number(),
        date: z.string(),
        confidence: z.number().min(0).max(1),
      }),
      z.object({
        type: z.literal("unknown"),
        reason: z.string().optional(),
      }),
    ]);

    const { object } = await generateObject({
      model: anthropicClient("claude-sonnet-4-6"),
      schema: VisionResponseSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: base64Image,
              mediaType: "image/jpeg",
            },
            {
              type: "text",
              text: `Analyze this image.

If it shows food/a meal: return type "meal" with estimated nutritional data per item.
- is_asian_cuisine: true if most items are Chinese, Japanese, Korean, Southeast Asian, etc.
- ai_confidence: your confidence in the estimates (0.0-1.0)

If it shows health/fitness data with a body weight reading: return type "weight".
- value_kg: the most recent weight value shown
- date: the date of that measurement in YYYY-MM-DD format (today is ${userDate} if no date shown)
- confidence: how certain you are this is a weight reading (0.0-1.0)

If you cannot identify the image as either food or a health measurement with weight data: return type "unknown".

Important: For multi-value health graphs, use only the most recent single value.`,
            },
          ],
        },
      ],
    });

    return NextResponse.json(object);
  } catch (error: unknown) {
    const err = error as { status?: number };
    if (err?.status === 429) {
      return NextResponse.json(
        { error: "Service busy, try again in a moment." },
        { status: 429 }
      );
    }
    if (err?.status && err.status >= 500) {
      return NextResponse.json(
        { error: "AI service unavailable." },
        { status: 503 }
      );
    }
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}
