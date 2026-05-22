import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { getConfig } from '../../config.js';

let sdk: NodeSDK | null = null;

export function initTracer(): void {
  const config = getConfig();

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: 'orderly',
      [ATTR_SERVICE_VERSION]: '1.0.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.nodeEnv,
    }),
    traceExporter: new OTLPTraceExporter({
      url:
        process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ??
        'http://localhost:4318/v1/traces',
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

export async function shutdownTracer(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}
