import { Global, Module } from '@nestjs/common';
import { MeiliService } from './meili.service';

@Global()
@Module({ providers: [MeiliService], exports: [MeiliService] })
export class MeiliModule {}