import { generateText } from "ai";
import {
  BEDROCK_MODEL_ID,
  BEDROCK_REGION,
  getBedrockModel,
} from "../src/mastra/bedrock.ts";

console.log(`Calling ${BEDROCK_MODEL_ID} in ${BEDROCK_REGION}...`);

const result = await generateText({
  model: getBedrockModel(),
  prompt: "Reply with exactly: Bedrock connection successful",
  maxOutputTokens: 64,
});

console.log(result.text);
