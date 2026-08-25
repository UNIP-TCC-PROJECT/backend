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
} from '@nestjs/common';

import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user-dto';
import { LoginDto } from './dto/loginDto';
import { UpdateOngDto } from './dto/update-ong-dto';
import { UpdateProfileDto } from './dto/update-profile-dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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
updateMe(@Request() req: any, @Body() updateProfileDto: UpdateProfileDto) {
  return this.usersService.updateProfile(req.user.id, updateProfileDto);
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
@UsePipes(new ValidationPipe())
updateOng(
  @Param('id', ParseIntPipe) id: number,
  @Body() updateOngDto: UpdateOngDto,
) {
  return this.usersService.updateOng(id, updateOngDto);
}
  
}