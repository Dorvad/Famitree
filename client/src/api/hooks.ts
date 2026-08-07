import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type {
  ArchiveItem,
  ArchiveKind,
  CreateArchiveItemRequest,
  CreateMilestoneRequest,
  CreatePersonRequest,
  CreateRelationshipRequest,
  JoinRequest,
  MediaRef,
  Milestone,
  Person,
  PersonDetail,
  Relationship,
  SessionResponse,
  TimelineEvent,
  TreeResponse,
  UpdatePersonRequest,
} from '../../../shared/types.ts';

import { request } from './client.ts';

export const queryKeys = {
  session: ['session'] as const,
  tree: ['tree'] as const,
  person: (id: string) => ['person', id] as const,
  archive: (kind?: ArchiveKind, personId?: string) => ['archive', kind ?? null, personId ?? null] as const,
  timeline: ['timeline'] as const,
};

/* -------------------------------------------------------------- session */

export function useSession(): UseQueryResult<SessionResponse> {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: () => request<SessionResponse>('/auth/session'),
    staleTime: 60_000,
  });
}

export function useJoin(): UseMutationResult<SessionResponse, Error, JoinRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: JoinRequest) =>
      request<SessionResponse>('/auth/join', { method: 'POST', body }),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.session, data);
      // Joining may have added a node, so the tree is stale.
      void qc.invalidateQueries({ queryKey: queryKeys.tree });
    },
  });
}

export function useLogout(): UseMutationResult<void, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<void>('/auth/logout', { method: 'POST' }),
    // Everything is permission-scoped, so drop the whole cache rather than
    // leave another account's view on screen.
    onSuccess: () => qc.clear(),
  });
}

export function useBindToPerson(): UseMutationResult<SessionResponse, Error, string | null> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (personId: string | null) =>
      request<SessionResponse>('/auth/bind', { method: 'POST', body: { personId } }),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.session, data);
      void qc.invalidateQueries({ queryKey: queryKeys.tree });
    },
  });
}

/* ----------------------------------------------------------------- tree */

export function useTree(): UseQueryResult<TreeResponse> {
  return useQuery({
    queryKey: queryKeys.tree,
    queryFn: () => request<TreeResponse>('/tree'),
    staleTime: 30_000,
  });
}

export function usePerson(id: string | undefined): UseQueryResult<PersonDetail> {
  return useQuery({
    queryKey: queryKeys.person(id ?? ''),
    queryFn: () => request<PersonDetail>(`/people/${encodeURIComponent(id as string)}`),
    enabled: Boolean(id),
  });
}

export function useCreatePerson(): UseMutationResult<Person, Error, CreatePersonRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePersonRequest) =>
      request<Person>('/people', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.tree }),
  });
}

export function useUpdatePerson(
  id: string,
): UseMutationResult<Person, Error, UpdatePersonRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePersonRequest) =>
      request<Person>(`/people/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.person(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.tree });
    },
  });
}

export function useAddMilestone(
  personId: string,
): UseMutationResult<Milestone, Error, CreateMilestoneRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMilestoneRequest) =>
      request<Milestone>(`/people/${encodeURIComponent(personId)}/milestones`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.person(personId) }),
  });
}

export function useAddRelationship(): UseMutationResult<
  Relationship,
  Error,
  CreateRelationshipRequest
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRelationshipRequest) =>
      request<Relationship>('/relationships', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.tree }),
  });
}

/* -------------------------------------------------------------- archive */

export function useArchive(
  kind?: ArchiveKind,
  personId?: string,
): UseQueryResult<ArchiveItem[]> {
  return useQuery({
    queryKey: queryKeys.archive(kind, personId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (kind) params.set('kind', kind);
      if (personId) params.set('personId', personId);
      const qs = params.toString();
      return request<ArchiveItem[]>(`/archive${qs ? `?${qs}` : ''}`);
    },
    staleTime: 30_000,
  });
}

export function useCreateArchiveItem(): UseMutationResult<
  ArchiveItem,
  Error,
  CreateArchiveItemRequest
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateArchiveItemRequest) =>
      request<ArchiveItem>('/archive', { method: 'POST', body }),
    // Every filtered view of the feed is now stale, so match on the prefix.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['archive'] }),
  });
}

export function useUploadMedia(): UseMutationResult<MediaRef, Error, File> {
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return request<MediaRef>('/media', { method: 'POST', formData });
    },
  });
}

/* ------------------------------------------------------------- timeline */

export function useTimeline(): UseQueryResult<TimelineEvent[]> {
  return useQuery({
    queryKey: queryKeys.timeline,
    queryFn: () => request<TimelineEvent[]>('/timeline'),
    staleTime: 60_000,
  });
}
