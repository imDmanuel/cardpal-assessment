import { Controller, Patch, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from './enums/user-role.enum';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch(':id/promote')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Promote a user to ADMIN (Admin Only)' })
  @ApiResponse({ status: 200, description: 'User promoted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async promote(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.promoteUser(id);
  }
}

