import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { NotFoundException } from '@nestjs/common';

describe('UsersService', () => {
  let service: UsersService;
  let repository: jest.Mocked<Repository<User>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get(getRepositoryToken(User));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create and save a user', async () => {
      const userData = { email: 'test@example.com' };
      const userInstance = { ...userData, id: '1' };
      repository.create.mockReturnValue(userInstance as any);
      repository.save.mockResolvedValue(userInstance as any);

      const result = await service.create(userData);

      expect(repository.create).toHaveBeenCalledWith(userData);
      expect(repository.save).toHaveBeenCalledWith(userInstance);
      expect(result).toEqual(userInstance);
    });
  });

  describe('findByEmail', () => {
    it('should find a user by email', async () => {
      const user = { email: 'test@example.com' };
      repository.findOne.mockResolvedValue(user as any);

      const result = await service.findByEmail('test@example.com');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(result).toEqual(user);
    });
  });

  describe('findById', () => {
    it('should find a user by id', async () => {
      const user = { id: '1' };
      repository.findOne.mockResolvedValue(user as any);

      const result = await service.findById('1');

      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
      expect(result).toEqual(user);
    });
  });

  describe('promoteUser', () => {
    it('should throw NotFoundException if user not found', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.promoteUser('1')).rejects.toThrow(NotFoundException);
    });

    it('should promote a user to ADMIN', async () => {
      const user = { id: '1', role: UserRole.USER };
      repository.findOne.mockResolvedValue(user as any);
      repository.save.mockResolvedValue({
        ...user,
        role: UserRole.ADMIN,
      } as any);

      const result = await service.promoteUser('1');

      expect(user.role).toBe(UserRole.ADMIN);
      expect(repository.save).toHaveBeenCalledWith(user);
      expect(result.message).toContain('promoted to ADMIN');
    });
  });
});
