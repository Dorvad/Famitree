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
  CreateTimelineEventRequest,
  JoinRequest,
  MediaRef,
  Milestone,
  Person,
  PersonDetail,
  Relationship,
  SessionResponse,
  TimelineEvent,
  TreeResponse,
  UpdateArchiveItemRequest,
  UpdateMilestoneRequest,
  UpdatePersonRequest,
  UpdateTimelineEventRequest,
} from '../../../shared/types.ts';

import { request } from './client.ts';
import { uploadMedia } from './uploads.ts';

export const queryKeys = {
  session: ['session'] as const,
  tree: ['tree'] as const,
  person: (id: string) => ['person', id] as const,
  archivedPeople: ['people', 'archived'] as const,
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
    // Reopening the same card within half a minute serves the cached record;
    // every save invalidates this key, so edits still refetch immediately.
    staleTime: 30_000,
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

/**
 * Persists a node's position after a drag on the tree.
 *
 * The drop handler has already written the new coordinates straight into the
 * tree cache — the node is visually where the finger left it — so success only
 * refreshes that person's own record. Failure means the board no longer
 * matches the server, and the honest fix is to refetch the truth.
 */
export function useMovePerson(): UseMutationResult<
  Person,
  Error,
  { id: string; x: number; y: number }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, x, y }) =>
      request<Person>(`/people/${encodeURIComponent(id)}`, { method: 'PATCH', body: { x, y } }),
    onError: () => void qc.invalidateQueries({ queryKey: queryKeys.tree }),
    onSuccess: (_person, { id }) =>
      void qc.invalidateQueries({ queryKey: queryKeys.person(id) }),
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

/** Stewards only. Powers the editor's "removed records" drawer. */
export function useArchivedPeople(enabled: boolean): UseQueryResult<Person[]> {
  return useQuery({
    queryKey: queryKeys.archivedPeople,
    queryFn: () => request<Person[]>('/people?includeArchived=1'),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Invalidates everything a person's identity feeds into. Archiving or restoring
 * changes the tree, the archived list, and that person's own page, so all three
 * have to be refetched together or the UI contradicts itself.
 */
function usePersonLifecycle(path: 'archive' | 'restore') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<Person>(`/people/${encodeURIComponent(id)}/${path}`, { method: 'POST' }),
    onSuccess: (person) => {
      void qc.invalidateQueries({ queryKey: queryKeys.tree });
      void qc.invalidateQueries({ queryKey: queryKeys.archivedPeople });
      // Archiving deliberately leaves the person's own query alone. The editor
      // is still mounted at this point, so both invalidating *and* removing
      // would make its live observer refetch — and GET /people/:id 404s for an
      // archived record. Left untouched, no request is made and the entry goes
      // stale as the editor unmounts a moment later.
      if (path === 'restore') {
        void qc.invalidateQueries({ queryKey: queryKeys.person(person.id) });
      }
    },
  });
}

export function useArchivePerson(): UseMutationResult<Person, Error, string> {
  return usePersonLifecycle('archive');
}

export function useRestorePerson(): UseMutationResult<Person, Error, string> {
  return usePersonLifecycle('restore');
}

export function useUpdateMilestone(
  personId: string,
): UseMutationResult<Milestone, Error, { id: string; patch: UpdateMilestoneRequest }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) =>
      request<Milestone>(
        `/people/${encodeURIComponent(personId)}/milestones/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: patch },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.person(personId) }),
  });
}

export function useRemoveMilestone(
  personId: string,
): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(
        `/people/${encodeURIComponent(personId)}/milestones/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.person(personId) }),
  });
}

export function useRemoveRelationship(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/relationships/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.tree }),
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

export function useUpdateArchiveItem(): UseMutationResult<
  ArchiveItem,
  Error,
  { id: string; patch: UpdateArchiveItemRequest }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) =>
      request<ArchiveItem>(`/archive/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['archive'] }),
  });
}

export function useRemoveArchiveItem(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/archive/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['archive'] }),
  });
}

export function useUploadMedia(): UseMutationResult<MediaRef, Error, File> {
  // The route the bytes take — through the API, or straight to the blob
  // store — is uploadMedia's decision; see api/uploads.ts.
  return useMutation({ mutationFn: uploadMedia });
}

/* ------------------------------------------------------------- timeline */

export function useTimeline(): UseQueryResult<TimelineEvent[]> {
  return useQuery({
    queryKey: queryKeys.timeline,
    queryFn: () => request<TimelineEvent[]>('/timeline'),
    staleTime: 60_000,
  });
}

export function useCreateTimelineEvent(): UseMutationResult<
  TimelineEvent,
  Error,
  CreateTimelineEventRequest
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTimelineEventRequest) =>
      request<TimelineEvent>('/timeline', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.timeline }),
  });
}

export function useUpdateTimelineEvent(): UseMutationResult<
  TimelineEvent,
  Error,
  { id: string; patch: UpdateTimelineEventRequest }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) =>
      request<TimelineEvent>(`/timeline/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.timeline }),
  });
}

export function useRemoveTimelineEvent(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/timeline/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.timeline }),
  });
}
