import {assertProductionEmailConfig,assertProductionInfrastructureConfig} from '@repus/validation';

assertProductionEmailConfig(process.env);
assertProductionInfrastructureConfig(process.env);
