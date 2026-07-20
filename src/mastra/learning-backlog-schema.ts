import { z } from "zod";

export const learningItemStatusSchema = z.enum([
  "not-started",
  "in-progress",
  "completed",
]);

export const learningItemDifficultySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const learningItemSchema = z
  .object({
    id: z.string().trim().min(1),
    topic: z.string().trim().min(1),
    description: z.string().trim().min(1),
    difficulty: learningItemDifficultySchema,
    prerequisites: z.array(z.string().trim().min(1)),
    status: learningItemStatusSchema,
  })
  .strict();

export const learningItemSummarySchema = learningItemSchema.omit({
  description: true,
});

export const learningBacklogSchema = z
  .object({
    items: z.array(learningItemSchema),
  })
  .strict()
  .superRefine(({ items }, context) => {
    const ids = new Set<string>();

    for (const [index, item] of items.entries()) {
      if (ids.has(item.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate learning item id: ${item.id}`,
          path: ["items", index, "id"],
        });
      }

      ids.add(item.id);
    }

    for (const [index, item] of items.entries()) {
      for (const [prerequisiteIndex, prerequisite] of
        item.prerequisites.entries()) {
        if (!ids.has(prerequisite)) {
          context.addIssue({
            code: "custom",
            message: `Unknown prerequisite id: ${prerequisite}`,
            path: ["items", index, "prerequisites", prerequisiteIndex],
          });
        }
      }
    }
  });

export type LearningItemStatus = z.infer<typeof learningItemStatusSchema>;
export type LearningItem = z.infer<typeof learningItemSchema>;
export type LearningItemSummary = z.infer<typeof learningItemSummarySchema>;
export type LearningBacklog = z.infer<typeof learningBacklogSchema>;
