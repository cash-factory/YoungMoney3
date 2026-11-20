import { createContext, useContext } from 'react';

export interface Experience {
  chapter: string;
  cue: string;
  variant: string;
  art?: string;
}

export const ExperienceContext = createContext<Experience | null>(null);
export const usePageExperience = () => useContext(ExperienceContext);
