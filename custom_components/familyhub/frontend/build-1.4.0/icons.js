const paths={
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  check:'<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m7 12 3 3 7-7"/>',
  cart:'<path d="M2 3h3l3 13h11l3-9H6"/><circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4m8-4v4M3 10h18m-13 5h2m4 0h2"/>',
  meal:'<path d="M4 3v5a3 3 0 0 0 6 0V3M7 3v18m10 0V3c-3 2-4 5-4 9h4"/>',
  repeat:'<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-3v4a3 3 0 0 1-3 3H3"/>',
  link:'<path d="m10 13 4-4m-7 6-1 1a3.5 3.5 0 0 0 5 5l4-4a3.5 3.5 0 0 0 0-5m2-3 1-1a3.5 3.5 0 0 0-5-5L9 7a3.5 3.5 0 0 0 0 5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',expand:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',shrink:'<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',arrow:'<path d="m9 6 6 6-6 6"/>',edit:'<path d="m4 16 12-12a2 2 0 0 1 4 4L8 20l-5 1zM14 6l4 4"/>'
};
export const icon=name=>'<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+paths[name]+'</svg>';
