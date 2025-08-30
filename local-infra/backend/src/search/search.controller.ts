import { Controller, Get, Query } from '@nestjs/common';
import { MeiliService } from '../common/meili/meili.service';

@Controller('search')
export class SearchController {
  constructor(private meili: MeiliService) {}

  @Get()
  async search(
    @Query('q') q = '',
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(parseInt(page, 10) || 1, 1);
    const ps = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);

    const idx = await this.meili.ensureVideosIndex();
    const res = await idx.search(q, {
      filter: ['visibility = public', 'status = ready'],
      page: p,
      hitsPerPage: ps,
      sort: ['createdAt:desc'],
    } as any);

    return res;
  }
}