import {
  Controller,
  Post,
  Body,
  UsePipes,
  ValidationPipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
  Request,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';

import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user-dto';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from '../auth/auth.service';
import { LoginDto } from './dto/loginDto';
import { UpdateOngDto } from './dto/update-ong-dto';
import { UpdateProfileDto } from './dto/update-profile-dto';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminGuard } from '../auth/admin.guard';
import { OngGuard } from '../auth/ong.guard';
import { UserType } from './entities/user.entity';

@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private authService: AuthService,
  ) {}

  @Post()
  @UsePipes(new ValidationPipe())
  createUser(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Post('login')
  @UsePipes(new ValidationPipe())
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() loginDto: LoginDto, @Request() req: any) {
    return this.authService.login(loginDto.email, loginDto.password, loginDto.otp, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Request() req: any) {
    return this.usersService.findById(req.user.id);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/avatars',
        filename: (req, file, cb) => {
          cb(null, `${randomUUID()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.mimetype)) {
          return cb(new BadRequestException('Formato inválido'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }
    const url = `/uploads/avatars/${file.filename}`;
    await this.usersService.updateProfileImage(req.user.id, url);
    return { profileImage: url };
  }

  @Get('admin-test')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminTest() {
    return {
      message: 'Acesso administrativo autorizado',
    };
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe())
  updateMe(@Request() req: any, @Body() updateProfileDto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, updateProfileDto);
  }

  @Get()
  @Roles(UserType.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  findAllUsers() {
    return this.usersService.findAllUsers();
  }

  @Get('ongs')
  findAllOngs() {
    return this.usersService.findAllOngs();
  }

  @Get('ongs/:id')
  findOngById(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOngById(id);
  }

  @Patch('ongs/:id')
  @Roles(UserType.ONG)
  @UseGuards(JwtAuthGuard, RolesGuard, OngGuard)
  @UsePipes(new ValidationPipe())
  updateOng(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOngDto: UpdateOngDto,
    @Request() req: any,
  ) {
    return this.usersService.updateOng(id, updateOngDto, req.user.id);
  }
}
