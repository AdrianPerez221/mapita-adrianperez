import { z } from "zod";

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  APP_USER_AGENT: z.string().min(10),

  // Opcionales (NO obligatorias en .env.local)
  NOMINATIM_BASE_URL: z.string().optional(),
  OVERPASS_INTERPRETER_URL: z.string().optional(),
  IGN_FEATURES_BASE_URL: z.string().optional(),
  COPERNICUS_EFAS_WMS_URL: z.string().optional(),
});

const rawEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  APP_USER_AGENT: process.env.APP_USER_AGENT,

  NOMINATIM_BASE_URL: process.env.NOMINATIM_BASE_URL,
  OVERPASS_INTERPRETER_URL: process.env.OVERPASS_INTERPRETER_URL,
  IGN_FEATURES_BASE_URL: process.env.IGN_FEATURES_BASE_URL,
  COPERNICUS_EFAS_WMS_URL: process.env.COPERNICUS_EFAS_WMS_URL,
};

const parsed = EnvSchema.safeParse(rawEnv);
const isBuild = process.env.NEXT_PHASE === "phase-production-build";

if (!parsed.success && !isBuild) {
  throw parsed.error;
}

export const env = (parsed.success ? parsed.data : rawEnv) as z.infer<typeof EnvSchema>;
