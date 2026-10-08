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
import { v4 as uuid } from 'uuid';

import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user-dto';
import { LoginDto } from './dto/loginDto';
import { UpdateOngDto } from './dto/update-ong-dto';
import { UpdateProfileDto } from './dto/update-profile-dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { OngGuard } from '../auth/ong.guard';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post()
  @UsePipes(new ValidationPipe())
  createUser(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Post('login')
  @UsePipes(new ValidationPipe())
  login(@Body() loginDto: LoginDto) {
    return this.usersService.login(loginDto.email, loginDto.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Request() req: any) {
    return this.usersService.findById(req.user.id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe())
  updateMe(
    @Request() req: any,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(
      req.user.id,
      updateProfileDto,
    );
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/avatars',
        filename: (req, file, cb) => {
          const nome = `${uuid()}${extname(file.originalname)}`;
          cb(null, nome);
        },
      }),
      fileFilter: (req, file, cb) => {
        const permitidos = /jpeg|jpg|png|webp/;
        const ok = permitidos.test(file.mimetype);

        if (!ok) {
          return cb(
            new BadRequestException('Formato inválido'),
            false,
          );
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

  @Get('ongs')
  findAllOngs() {
    return this.usersService.findAllOngs();
  }

  @Get('ongs/:id')
  findOngById(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOngById(id);
  }

  @Patch('ongs/:id')
  @UseGuards(JwtAuthGuard, OngGuard)
  @UsePipes(new ValidationPipe())
  updateOng(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOngDto: UpdateOngDto,
  ) {
    return this.usersService.updateOng(
      id,
      updateOngDto,
      req.user.id,
    );
  }
}