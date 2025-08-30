import { Injectable } from '@nestjs/common';
import { MeiliSearch, Index } from 'meilisearch';

@Injectable()
export class MeiliService {
  client = new MeiliSearch({
    host: process.env.MEILI_HOST || 'http://meilisearch:7700',
    apiKey: process.env.MEILI_MASTER_KEY,
  });

  async ensureVideosIndex(): Promise<Index<any>> {
    try {
      await this.client.getIndex('videos');
    } catch (_) {
      await this.client.createIndex('videos', { primaryKey: 'id' });
    }
    const idx = this.client.index('videos');
    await idx.updateSettings({
      searchableAttributes: ['title', 'tags'],
      filterableAttributes: ['visibility', 'status', 'ownerId', 'tags'],
      sortableAttributes: ['createdAt'],
    });
    return idx;
  }
}