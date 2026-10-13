import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { api, ApiError } from './api';

/** Loads a container once per request, shared by the layout and the page; 404s for unknown ids. */
export const getContainer = cache(async (id: string) => {
  try {
    return await api.container(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
});
