import { Module } from '@nestjs/common';
import { AuthConnectorModule } from '../../../connectors/auth/auth-connector.module';
import { ConfigConnectorModule } from '../../../connectors/config/config-connector.module';
import { DbModule } from '../../../db/db.module';
import { ReposModule } from '../../../repos/repos.module';
import { CommonControllerModule } from '../../../controllers/common/common-controller.module';
import { WebhookControllerModule } from '../../../controllers/webhook-controller/webhook-controller.module';
import { SyncControllerModule } from '../../../controllers/sync-controller/sync-controller.module';
import { OperationsControllerModule } from '../../../controllers/operations-controller/operations-controller.module';
import { BalanceControllerModule } from '../../../controllers/balance-controller/balance-controller.module';
import { SponsorsControllerModule } from '../../../controllers/sponsors-controller/sponsors-controller.module';
import { AssetsControllerModule } from '../../../controllers/assets-controller/assets-controller.module';
import { ForecastControllerModule } from '../../../controllers/forecast-controller/forecast-controller.module';
import { VerificationControllerModule } from '../../../controllers/verification-controller/verification-controller.module';
import { TagsControllerModule } from '../../../controllers/tags-controller/tags-controller.module';

/**
 * Root module for the v2 (layered) HTTP app. Wires the foundation (config + DB
 * client + repo registry + common/health) plus the finance domain controllers.
 */
@Module({
  imports: [
    DbModule.forRoot(),
    AuthConnectorModule,
    ReposModule,
    ConfigConnectorModule,
    CommonControllerModule,
    WebhookControllerModule,
    SyncControllerModule,
    OperationsControllerModule,
    BalanceControllerModule,
    SponsorsControllerModule,
    AssetsControllerModule,
    ForecastControllerModule,
    VerificationControllerModule,
    TagsControllerModule,
  ],
})
export class HttpApiModule {}
