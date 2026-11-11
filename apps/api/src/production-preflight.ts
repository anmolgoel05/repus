import {assertProductionEmailConfig,assertProductionInfrastructureConfig,trustedProxyHops} from '@repus/validation';

assertProductionEmailConfig(process.env);
assertProductionInfrastructureConfig(process.env);
trustedProxyHops(process.env);
