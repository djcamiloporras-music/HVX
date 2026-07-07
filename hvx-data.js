/* ============================================================
   HVX MUSIC — Data Layer
   Artists and releases live here.
   To add an artist: copy a placeholder object and fill in.
   To add a release: copy the schema at the bottom and add.
   ============================================================ */

window.HVX = {

  /* ----------------------------------------------------------
     ARTISTS — 3 official slots
     Set placeholder: false and fill all fields when ready.
  ---------------------------------------------------------- */
  artists: [
    {
      id:          'artist-1',
      name:        'Artist Name',
      genre:       'House',
      city:        'TBA',
      bio:         'Biography coming soon.',
      photo:       null,
      placeholder: true,
      social: {
        instagram:  '#',
        soundcloud: '#',
        spotify:    '#',
      },
    },
    {
      id:          'artist-2',
      name:        'Artist Name',
      genre:       'Tech House',
      city:        'TBA',
      bio:         'Biography coming soon.',
      photo:       null,
      placeholder: true,
      social: {
        instagram:  '#',
        soundcloud: '#',
        spotify:    '#',
      },
    },
    {
      id:          'artist-3',
      name:        'Artist Name',
      genre:       'Afro House',
      city:        'TBA',
      bio:         'Biography coming soon.',
      photo:       null,
      placeholder: true,
      social: {
        instagram:  '#',
        soundcloud: '#',
        spotify:    '#',
      },
    },
  ],

  /* ----------------------------------------------------------
     RELEASES
     Add each release as an object in this array.
     The Releases section on index.html renders from here.

     Schema (copy and fill):
     {
       id:     'release-1',
       artist: 'Artist Name',
       title:  'Track Title',
       date:   '2026-MM-DD',      // ISO format
       genre:  'House',
       art:    null,              // 'assets/covers/filename.jpg' when ready
       links: {
         spotify:    '',
         appleMusic: '',
         beatport:   '',
         soundcloud: '',
       },
     },
  ---------------------------------------------------------- */
  releases: [
    // Releases will appear here as they are published.
  ],

};
