import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Project {
  id: string;
  name: string;
  description?: string;
  projectKey?: string | null; // 다른 사용자가 검색해 가입 요청할 때 쓰는 공유용 키
  role: 'owner' | 'editor' | 'viewer';
}

interface ProjectStore {
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  selectedProjectId: string | null;
  setSelectedProjectId: (projectId?: string | null) => void;
}

export const useProject = create<ProjectStore>()(
  persist(
    (set) => ({
      projects: [],
      setProjects: (projects: Project[]) => set({ projects }),
      selectedProjectId: null,
      setSelectedProjectId: (projectId?: string | null) => set({ selectedProjectId: projectId ?? null }),
    }),
    {
      name: 'project-storage',
      partialize: (state) => ({
        selectedProjectId: state.selectedProjectId,
      }),
    }
  )
);
