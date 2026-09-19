import "dotenv/config";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import express from "express";
import serverless from "serverless-http";
import { createApp } from "../server/_core/index";

let cachedApp: ReturnType<typeof express> | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cachedApp) {
    const { app } = await createApp();
    cachedApp = app;
  }

  return serverless(cachedApp)(req as any, res as any);
}
