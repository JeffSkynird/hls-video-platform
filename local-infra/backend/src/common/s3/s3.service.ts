import { Injectable } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost, PresignedPostOptions } from '@aws-sdk/s3-presigned-post';

@Injectable()
export class S3Service {
  private client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    },
  });

  async presignPost(params: {
    bucket: string; key: string; contentType: string; maxSize: number; expiresIn?: number;
  }) {
    const conditions: PresignedPostOptions['Conditions'] = [
      ['content-length-range', 1, params.maxSize],
      { 'Content-Type': params.contentType },
      ['starts-with', '$key', params.key],
    ];
    const res = await createPresignedPost(this.client, {
      Bucket: params.bucket,
      Key: params.key,
      Expires: params.expiresIn ?? 300,
      Conditions: conditions,
      Fields: { 'Content-Type': params.contentType },
    });
    return res; // { url, fields }
  }
}