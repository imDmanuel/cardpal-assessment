import { ExecutionContext, CallHandler } from '@nestjs/common';
import { ResponseInterceptor } from './response.interceptor';
import { of } from 'rxjs';

describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor<any>;
  let mockContext: any;
  let mockCallHandler: any;

  beforeEach(() => {
    interceptor = new ResponseInterceptor();
    mockContext = {
      switchToHttp: jest.fn().mockReturnThis(),
      getResponse: jest.fn().mockReturnValue({ statusCode: 200 }),
    };
    mockCallHandler = {
      handle: jest.fn(),
    };
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should wrap simple data in the data property', (done) => {
    const data = { id: 1, name: 'Test' };
    mockCallHandler.handle.mockReturnValue(of(data));

    interceptor
      .intercept(
        mockContext as ExecutionContext,
        mockCallHandler as CallHandler,
      )
      .subscribe((result) => {
        expect(result).toEqual({
          success: true,
          statusCode: 200,
          data: data,
        });
        done();
      });
  });

  it('should extract message property to the top level and remove it from data', (done) => {
    const data = { id: 1, message: 'Operation successful' };
    mockCallHandler.handle.mockReturnValue(of(data));

    interceptor
      .intercept(
        mockContext as ExecutionContext,
        mockCallHandler as CallHandler,
      )
      .subscribe((result) => {
        expect(result).toEqual({
          success: true,
          statusCode: 200,
          message: 'Operation successful',
          data: { id: 1 },
        });
        done();
      });
  });

  it('should omit data property if it becomes empty after message extraction', (done) => {
    const data = { message: 'Only a message' };
    mockCallHandler.handle.mockReturnValue(of(data));

    interceptor
      .intercept(
        mockContext as ExecutionContext,
        mockCallHandler as CallHandler,
      )
      .subscribe((result) => {
        expect(result).toEqual({
          success: true,
          statusCode: 200,
          message: 'Only a message',
        });
        expect(result).not.toHaveProperty('data');
        done();
      });
  });

  it('should omit data property if original data is null or undefined', (done) => {
    mockCallHandler.handle.mockReturnValue(of(null));

    interceptor
      .intercept(
        mockContext as ExecutionContext,
        mockCallHandler as CallHandler,
      )
      .subscribe((result) => {
        expect(result).toEqual({
          success: true,
          statusCode: 200,
        });
        expect(result).not.toHaveProperty('data');
        done();
      });
  });

  it('should handle string responses as data', (done) => {
    const data = 'plain string';
    mockCallHandler.handle.mockReturnValue(of(data));

    interceptor
      .intercept(
        mockContext as ExecutionContext,
        mockCallHandler as CallHandler,
      )
      .subscribe((result) => {
        expect(result).toEqual({
          success: true,
          statusCode: 200,
          data: 'plain string',
        });
        done();
      });
  });
});
