import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AUTO_REFRESH_MS,
  MAX_CONNECTION_DEPTH,
  MIN_CONNECTION_DEPTH,
  MAX_VISIBLE_SIBLINGS,
} from "../config/constants";
import { createMemgraphClient } from "../lib/memgraphClient";
import { useGraphStore } from "../state/graphStore";

const client = createMemgraphClient();
const STORAGE_KEYS = {
  selectedProjectId: "code-visual:selectedProjectId",
  autoRefreshEnabled: "code-visual:autoRefreshEnabled",
} as const;

function readStoredString(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const raw = readStoredString(key);
  if (raw === null) return fallback;
  return raw === "true";
}

export function useGraphController() {
  const graphState = useGraphStore();
  const preferredProjectIdRef = useRef<string | null>(
    readStoredString(STORAGE_KEYS.selectedProjectId),
  );
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() =>
    readStoredBoolean(STORAGE_KEYS.autoRefreshEnabled, true),
  );

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: client.listProjects,
    refetchInterval: autoRefreshEnabled ? AUTO_REFRESH_MS : false,
    staleTime: AUTO_REFRESH_MS,
  });

  const fetchNodePage = useCallback(
    async (projectId: string, parentId: string, page: number) => {
      const store = useGraphStore.getState();
      store.setNodeLoading(parentId, true);

      try {
        const result = await client.expandNodePage({
          projectId,
          parentId,
          page,
          pageSize: MAX_VISIBLE_SIBLINGS,
        });
        useGraphStore.getState().mergeExpansionPage(result);
      } catch (error) {
        useGraphStore
          .getState()
          .setNodeLoading(
            parentId,
            false,
            error instanceof Error ? error.message : "Expansion failed",
          );
        throw error;
      }
    },
    [],
  );

  const hydrateNeighborhoodToDepth = useCallback(
    async (startNodeId: string) => {
      const snapshot = useGraphStore.getState();
      const projectId = snapshot.projectId;
      const connectionDepth = snapshot.connectionDepth;
      if (!projectId) return;

      snapshot.setNodeExpanded(startNodeId, true);

      snapshot.setSyncStatus("syncing");

      try {
        const parents = await client.expandNeighborhoodDepth({
          projectId,
          startNodeId,
          depth: connectionDepth,
        });

        useGraphStore.getState().mergeExpansionBatch({ parents });
        useGraphStore.getState().setSyncStatus("idle");
      } catch (error) {
        useGraphStore
          .getState()
          .setSyncStatus(
            "error",
            error instanceof Error ? error.message : "Sync failed",
          );
      }
    },
    [],
  );

  const selectedNode = useMemo(() => {
    if (!graphState.selectedNodeId) return undefined;
    return graphState.nodesById[graphState.selectedNodeId];
  }, [graphState.nodesById, graphState.selectedNodeId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.autoRefreshEnabled,
        String(autoRefreshEnabled),
      );
    } catch {
      // ignore storage failures
    }
  }, [autoRefreshEnabled]);

  useEffect(() => {
    if (!graphState.projectId || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.selectedProjectId,
        graphState.projectId,
      );
    } catch {
      // ignore storage failures
    }
  }, [graphState.projectId]);

  useEffect(() => {
    const list = projectsQuery.data ?? [];
    if (!graphState.projectId && list.length > 0) {
      const preferredId = preferredProjectIdRef.current;
      const project =
        (preferredId
          ? list.find((item) => item.id === preferredId)
          : undefined) ?? list[0];
      graphState.setProject(project.id, {
        id: project.rootNodeId,
        label: project.name,
        kind: project.rootKind ?? "project",
        visualKind: project.rootVisualKind ?? "layer",
      });

      void hydrateNeighborhoodToDepth(project.rootNodeId);
    }
  }, [graphState, hydrateNeighborhoodToDepth, projectsQuery.data]);

  useEffect(() => {
    if (!projectsQuery.isError) return;

    const message =
      projectsQuery.error instanceof Error
        ? projectsQuery.error.message
        : "Failed to load projects";
    useGraphStore.getState().setSyncStatus("error", message);
  }, [projectsQuery.error, projectsQuery.isError]);

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    if (
      !graphState.projectId ||
      (!graphState.focusedNodeId && !graphState.rootNodeId)
    )
      return;

    const focusId = graphState.focusedNodeId ?? graphState.rootNodeId;
    if (!focusId) return;

    const timer = setInterval(() => {
      void hydrateNeighborhoodToDepth(focusId);
    }, AUTO_REFRESH_MS);

    return () => clearInterval(timer);
  }, [
    autoRefreshEnabled,
    graphState.projectId,
    graphState.focusedNodeId,
    graphState.rootNodeId,
    hydrateNeighborhoodToDepth,
  ]);

  const selectProject = (projectId: string) => {
    const project = (projectsQuery.data ?? []).find(
      (item) => item.id === projectId,
    );
    if (!project) return;

    graphState.setProject(project.id, {
      id: project.rootNodeId,
      label: project.name,
      kind: project.rootKind ?? "project",
      visualKind: project.rootVisualKind ?? "layer",
    });

    void hydrateNeighborhoodToDepth(project.rootNodeId);
  };

  const expandNode = (nodeId: string) => {
    const node = graphState.nodesById[nodeId];
    if (!node || !graphState.projectId) return;

    graphState.setSelectedNode(nodeId);
    graphState.setFocusedNode(nodeId);
    graphState.setNodeExpanded(nodeId, true);
    void hydrateNeighborhoodToDepth(nodeId);
  };

  const changeSiblingPage = (parentId: string, nextPage: number) => {
    if (!graphState.projectId) return;

    graphState.setSiblingPage(parentId, nextPage);
    void fetchNodePage(graphState.projectId, parentId, nextPage);
  };

  const increaseDepth = () => {
    const nextDepth = Math.min(
      MAX_CONNECTION_DEPTH,
      graphState.connectionDepth + 1,
    );
    if (nextDepth === graphState.connectionDepth) return;

    graphState.setConnectionDepth(nextDepth);
    const focusId = graphState.focusedNodeId ?? graphState.rootNodeId;
    if (focusId) {
      void hydrateNeighborhoodToDepth(focusId);
    }
  };

  const decreaseDepth = () => {
    const nextDepth = Math.max(
      MIN_CONNECTION_DEPTH,
      graphState.connectionDepth - 1,
    );
    if (nextDepth === graphState.connectionDepth) return;

    graphState.setConnectionDepth(nextDepth);
    const focusId = graphState.focusedNodeId ?? graphState.rootNodeId;
    if (focusId) {
      void hydrateNeighborhoodToDepth(focusId);
    }
  };

  return {
    mode: client.mode,
    projectsQuery,
    selectedNode,
    graphState,
    selectProject,
    expandNode,
    changeSiblingPage,
    increaseDepth,
    decreaseDepth,
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    isSyncing: graphState.syncStatus === "syncing",
  };
}
