import { useEffect } from 'react';

const BASE = 'KoBo';

/** Sets the tab title to "KoBo | <page>"; restores the base title on unmount. Pass null/'' while data is loading. */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title === BASE ? BASE : `${BASE} | ${title}`;
    return () => { document.title = previous || BASE; };
  }, [title]);
}
