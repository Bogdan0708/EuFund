-- Add new AI model preference options
ALTER TYPE "ai_model_preference" ADD VALUE IF NOT EXISTS 'claude-haiku';
ALTER TYPE "ai_model_preference" ADD VALUE IF NOT EXISTS 'gpt-4o-mini';
ALTER TYPE "ai_model_preference" ADD VALUE IF NOT EXISTS 'gpt-4o-nano';
ALTER TYPE "ai_model_preference" ADD VALUE IF NOT EXISTS 'gemini-flash';
ALTER TYPE "ai_model_preference" ADD VALUE IF NOT EXISTS 'nano-banana';
