/* CVMILOPORRAS_SERVER */

window.HVX_CONFIG = {

  label: {
    name:     'HVX Music',
    email:    'info@hvxmusic.com',
    location: 'New York, USA',
    year:     2026,
  },

  social: {
    instagram:  'https://www.instagram.com/hvxmusic',
    soundcloud: 'https://soundcloud.com/hvxmusic',
    spotify:    '#',          // Update when profile is live
    appleMusic: '#',          // Update when profile is live
    beatport:   '#',          // Update when profile is live
    youtube:    'https://www.youtube.com/@hvxmusic',
  },

  /* Store behaviour */
  shop: {
    /* false: the site stays public and only checkout asks for an account.
       true:  visitors must sign in before they can see anything.        */
    requireAuthOnEntry: false,
  },

  /* Demo submissions run through TrackStack. This is the only place the
     link lives; leaving it empty hides the open call and its buttons, so
     the site never sends anyone to a dead page. */
  demos: {
    trackstack: 'https://tstack.link/hvxmusic-0XnScKNGhrv1sf1c9dHJU',
  },

  /* Future backend endpoints - leave empty until ready */
  forms: {
    demo:    '',   // Google Apps Script URL
    booking: '',   // Google Apps Script URL
    contact: '',   // Google Apps Script URL
  },

};
