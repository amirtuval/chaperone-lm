import type { LanguageModelV3 } from '@ai-sdk/provider'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { ChannelConfig } from '../types.js'
import type { AdapterRequestError, GatewayRequest } from './types.js'
import { AISdkAdapter } from './aisdk-base.js'
import { wrapV2AsV3 } from './v2-compat.js'

export class BedrockAdapter extends AISdkAdapter {
  transformRequest(req: GatewayRequest): GatewayRequest | AdapterRequestError {
    return req
  }

  createModel(
    channelConfig: ChannelConfig,
    modelId: string,
    _deploymentId?: string
  ): LanguageModelV3 {
    if (channelConfig.type !== 'bedrock') {
      throw new Error(`BedrockAdapter requires channel type 'bedrock', got '${channelConfig.type}'`)
    }
    return wrapV2AsV3(createAmazonBedrock({ region: channelConfig.region })(modelId))
  }
}
