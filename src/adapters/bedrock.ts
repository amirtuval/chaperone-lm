import type { LanguageModel } from 'ai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import type { ChannelConfig } from '../types.js'
import type { AdapterRequestError, GatewayRequest } from './types.js'
import { AISdkAdapter } from './aisdk-base.js'

export class BedrockAdapter extends AISdkAdapter {
  transformRequest(req: GatewayRequest): GatewayRequest | AdapterRequestError {
    return req
  }

  createModel(
    channelConfig: ChannelConfig,
    modelId: string,
    _deploymentId?: string
  ): LanguageModel {
    if (channelConfig.type !== 'bedrock') {
      throw new Error(`BedrockAdapter requires channel type 'bedrock', got '${channelConfig.type}'`)
    }
    return createAmazonBedrock({ region: channelConfig.region })(modelId)
  }
}
