// Zod validation for the stored enum-colour JSONB. The model and the resolvers
// the grid calls per cell live in `./enum-color`.

import { z } from "zod";

import { thresholdColorSchema } from "./threshold-schema";

export const enumColorMapSchema = z
  .array(
    z.object({
      value: z.string().min(1),
      color: thresholdColorSchema,
    }),
  )
  .readonly();
