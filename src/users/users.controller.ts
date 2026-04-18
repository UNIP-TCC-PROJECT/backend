import { Controller, Post, Body } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post()
  createUser(@Body() body: any) {
    return this.usersService.create(body);
  }

  @Post('login')
  login(@Body() body: any) {
    return this.usersService.login(body.email, body.password);
  }
}