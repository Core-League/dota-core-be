import { createConfigNamespace } from '../helpers/create-config-namespace';
import { EnvSchema } from '../../../types/entities/env';

export const CONFIG_ENV_TOKEN = 'env-config';

export const configEnvNamespace = createConfigNamespace(
  CONFIG_ENV_TOKEN,
  process.env,
  EnvSchema,
);
