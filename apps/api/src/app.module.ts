import { Module } from '@nestjs/common';
import { SalesCrmModule } from './modules/sales-crm/sales-crm.module';
import { ProposalGovernanceModule } from './modules/proposal-governance/proposal-governance.module';
import { DeliveryHandoffModule } from './modules/delivery-handoff/delivery-handoff.module';
import { FinanceSignalModule } from './modules/finance-signal/finance-signal.module';
import { ResourceControlsModule } from './modules/resource-controls/resource-controls.module';
import { CustomerExperienceModule } from './modules/customer-experience/customer-experience.module';
import { ManagementIntelligenceModule } from './modules/management-intelligence/management-intelligence.module';
import { ArtifactMgmtModule } from './modules/artifact-mgmt/artifact-mgmt.module';
import { SharedCollaborationModule } from './modules/shared-collaboration/shared-collaboration.module';
import { PlatformHealthModule } from './modules/platform-health/platform-health.module';
import { IdentityAccessModule } from './modules/identity-access/identity-access.module';
import { TenantWorkspaceModule } from './modules/tenant-workspace/tenant-workspace.module';
import { WorkforceAnalyticsModule } from './modules/workforce-analytics/workforce-analytics.module';
import { WorkspaceCalendarModule } from './modules/workspace-calendar/workspace-calendar.module';
import { BrdGovernanceModule } from './modules/brd-governance/brd-governance.module';
import { WorkspaceAdminModule } from './modules/workspace-admin/workspace-admin.module';

@Module({
  imports: [
    PlatformHealthModule,
    TenantWorkspaceModule,
    IdentityAccessModule,
    SalesCrmModule,
    ProposalGovernanceModule,
    DeliveryHandoffModule,
    FinanceSignalModule,
    ResourceControlsModule,
    CustomerExperienceModule,
    ManagementIntelligenceModule,
    ArtifactMgmtModule,
    SharedCollaborationModule,
    WorkforceAnalyticsModule,
    WorkspaceCalendarModule,
    BrdGovernanceModule,
    WorkspaceAdminModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
