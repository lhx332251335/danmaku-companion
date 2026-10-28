import { useCallback, useEffect, useState } from "react";
import { pageFromHash, type PageId } from "../constants";

/** The current page from location.hash (#capture deep-links); unknown hashes show the overview. */
export function useHashPage(): [PageId, (page: PageId) => void] {
  const [page, setPage] = useState<PageId>(() => pageFromHash(window.location.hash));

  useEffect(() => {
    const sync = () => setPage(pageFromHash(window.location.hash));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const navigate = useCallback((next: PageId) => {
    if (window.location.hash !== `#${next}`) {
      window.location.hash = next;
    }
    setPage(next);
  }, []);

  return [page, navigate];
}
