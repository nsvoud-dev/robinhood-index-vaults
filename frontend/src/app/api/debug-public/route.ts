import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * Debug route: list files in the public directory as the Next.js server sees it.
 * Open /api/debug-public in the browser to verify static file paths.
 * Remove or restrict this route in production.
 */
export async function GET() {
  const cwd = process.cwd();
  const publicDir = path.join(cwd, "public");
  const logosDir = path.join(publicDir, "logos");

  const result: {
    cwd: string;
    publicExists: boolean;
    logosExists: boolean;
    publicFiles: string[];
    logosFiles: string[];
    expectedUrls: string[];
  } = {
    cwd,
    publicExists: false,
    logosExists: false,
    publicFiles: [],
    logosFiles: [],
    expectedUrls: [],
  };

  try {
    result.publicExists = fs.existsSync(publicDir);
    if (result.publicExists) {
      result.publicFiles = fs.readdirSync(publicDir);
    }
    result.logosExists = fs.existsSync(logosDir);
    if (result.logosExists) {
      result.logosFiles = fs.readdirSync(logosDir);
      result.expectedUrls = result.logosFiles
        .filter((f) => f.endsWith(".png"))
        .map((f) => `/logos/${f}`);
    }
  } catch (err) {
    return NextResponse.json(
      { error: String(err), ...result },
      { status: 500 }
    );
  }

  return NextResponse.json(result);
}
