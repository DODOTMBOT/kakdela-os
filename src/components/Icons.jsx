function Svg({ children, size = 20, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;

export const IconGrid = (p) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </Svg>
);

export const IconCalendar = (p) => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="15" rx="3" />
    <path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
  </Svg>
);

export const IconEdit = (p) => (
  <Svg {...p}>
    <path d="M14.5 5.5l4 4M4 20l1-4.5L15.5 5a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L8.5 19z" />
  </Svg>
);

export const IconFolder = (p) => (
  <Svg {...p}>
    <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </Svg>
);

export const IconUpload = (p) => <Svg {...p}><path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 15.5v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" /></Svg>;
export const IconDownload = (p) => <Svg {...p}><path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5M5 15.5v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" /></Svg>;

export const IconSearch = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Svg>
);

export const IconBell = (p) => (
  <Svg {...p}>
    <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Svg>
);

// Иконки бокового меню — тот же контурный стиль, что и у остальных.
export const IconHome = (p) => <Svg {...p}><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></Svg>;
export const IconCheckSquare = (p) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Svg>
);
export const IconBookOpen = (p) => (
  <Svg {...p}>
    <path d="M12 6.5c-1.8-1.3-4.2-2-7-2v13c2.8 0 5.2.7 7 2 1.8-1.3 4.2-2 7-2v-13c-2.8 0-5.2.7-7 2z" />
    <path d="M12 6.5v13" />
  </Svg>
);
export const IconClock = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l2.5 2.5" />
  </Svg>
);
export const IconClipboard = (p) => (
  <Svg {...p}>
    <path d="M9 5H7.5A2.5 2.5 0 0 0 5 7.5v11A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 16.5 5H15" />
    <rect x="9" y="3.5" width="6" height="3" rx="1" />
    <path d="M9 12h6M9 15.5h4" />
  </Svg>
);
export const IconGraduation = (p) => (
  <Svg {...p}>
    <path d="M3 9.5 12 5l9 4.5-9 4.5z" />
    <path d="M7 11.5V16c1.3 1.3 3 2 5 2s3.7-.7 5-2v-4.5M21 9.5V14" />
  </Svg>
);
export const IconShieldCheck = (p) => (
  <Svg {...p}>
    <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
export const IconMegaphone = (p) => (
  <Svg {...p}>
    <path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z" />
    <path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
);
export const IconBulb = (p) => (
  <Svg {...p}>
    <path d="M9 17.5h6M10 20.5h4" />
    <path d="M12 3.5a5.5 5.5 0 0 0-3.2 10c.7.5 1.2 1.3 1.2 2.2v.3h4v-.3c0-.9.5-1.7 1.2-2.2A5.5 5.5 0 0 0 12 3.5z" />
  </Svg>
);
export const IconMapPinPlus = (p) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
    <path d="M12 7.5v5M9.5 10h5" />
  </Svg>
);
export const IconWallet = (p) => (
  <Svg {...p}>
    <rect x="3.5" y="6.5" width="17" height="12.5" rx="2.5" />
    <path d="M6.5 6.5V5A1.5 1.5 0 0 1 8 3.5h9M16 12.75h1.5" />
  </Svg>
);
export const IconChart = (p) => <Svg {...p}><path d="M4 20h16M7 16v-5M12 16V7M17 16v-3" /></Svg>;
export const IconUsers = (p) => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3" />
    <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M15.5 5.7a3 3 0 0 1 0 5.6M17.5 14.8c1.6.6 2.6 2 3 4.2" />
  </Svg>
);
export const IconSliders = (p) => (
  <Svg {...p}>
    <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="17" r="2" />
  </Svg>
);
export const IconTicket = (p) => (
  <Svg {...p}>
    <path d="M4 8a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" />
    <path d="M14 7.5v1.5M14 11.25v1.5M14 15v1.5" />
  </Svg>
);
export const IconLink = (p) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);
export const IconMenuLines = (p) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>;

export const IconChevronLeft = (p) => <Svg {...p}><path d="m14.5 6-6 6 6 6" /></Svg>;
export const IconChevronRight = (p) => <Svg {...p}><path d="m9.5 6 6 6-6 6" /></Svg>;
export const IconClose = (p) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconTrash = (p) => <Svg {...p}><path d="M5 7h14M10 7V5h4v2M7 7l.8 12h8.4L17 7" /></Svg>;
