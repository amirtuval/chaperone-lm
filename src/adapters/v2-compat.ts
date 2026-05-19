import type {
  LanguageModelV2,
  LanguageModelV2FinishReason,
  LanguageModelV2Usage,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider'

function normalizeFinishReason(v2: LanguageModelV2FinishReason): LanguageModelV3FinishReason {
  return { unified: v2 === 'unknown' ? 'other' : v2, raw: v2 }
}

function normalizeUsage(v2: LanguageModelV2Usage): LanguageModelV3Usage {
  const cached = v2.cachedInputTokens ?? 0
  const reasoning = v2.reasoningTokens ?? 0
  const input = v2.inputTokens ?? 0
  const output = v2.outputTokens ?? 0
  return {
    inputTokens: {
      total: input,
      noCache: input - cached,
      cacheRead: cached,
      cacheWrite: 0,
    },
    outputTokens: {
      total: output,
      text: output - reasoning,
      reasoning,
    },
  }
}

export function wrapV2AsV3(model: LanguageModelV2): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,

    async doGenerate(options: LanguageModelV3CallOptions) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await model.doGenerate(options as any)
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: result.content as any,
        finishReason: normalizeFinishReason(result.finishReason),
        usage: normalizeUsage(result.usage),
        warnings: [],
      }
    },

    async doStream(options: LanguageModelV3CallOptions) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { stream } = await model.doStream(options as any)
      const normalized = (stream as unknown as ReadableStream<LanguageModelV3StreamPart>).pipeThrough(
        new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
          transform(chunk, controller) {
            if (chunk.type === 'finish') {
              controller.enqueue({
                type: 'finish',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                finishReason: normalizeFinishReason((chunk as any).finishReason),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                usage: normalizeUsage((chunk as any).usage),
              })
            } else {
              controller.enqueue(chunk)
            }
          },
        })
      )
      return { stream: normalized }
    },
  }
}
