import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { OrganizationDocument } from './entities/organization-document.entity';
import { OrganizationValidation } from './entities/organization-validation.entity';
import { Organization } from './entities/organization.entity';
import { ExternalChecksService } from './external-checks.service';
import { OrganizationExternalCheck } from './entities/organization-external-check.entity';
import { AdminOrganizationsController, OrganizationsController, PublicOrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { CnpjVerificationService } from '../cnpj-verification/cnpj-verification.service';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, OrganizationDocument, OrganizationValidation, OrganizationExternalCheck, User]), AuthModule],
  controllers: [PublicOrganizationsController, OrganizationsController, AdminOrganizationsController],
  providers: [OrganizationsService, ExternalChecksService, CnpjVerificationService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
