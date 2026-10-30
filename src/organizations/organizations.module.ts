import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { OrganizationDocument } from './entities/organization-document.entity';
import { OrganizationValidation } from './entities/organization-validation.entity';
import { Organization } from './entities/organization.entity';
import { AdminOrganizationsController, OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, OrganizationDocument, OrganizationValidation, User]), AuthModule],
  controllers: [OrganizationsController, AdminOrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
