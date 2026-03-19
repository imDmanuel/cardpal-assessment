import { ValueTransformer } from 'typeorm';
import Decimal from 'decimal.js';

export const DecimalTransformer: ValueTransformer = {
  to: (value: unknown) => (value instanceof Decimal ? value.toString() : value),
  from: (value: string | null) => (value ? new Decimal(value) : value),
};

