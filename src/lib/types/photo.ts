export type PhotoStatus = 'PENDING' | 'APPROVED' | 'ARCHIVED';

export interface GalaPhoto {
    photo_id: string;
    s3_key: string;
    url: string;
    status: PhotoStatus;
    author_name?: string;
    created_at: number;
    moderated_by?: string;
    moderated_at?: number;
}