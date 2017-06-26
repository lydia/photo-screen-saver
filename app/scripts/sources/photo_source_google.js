/*
 *  Copyright (c) 2015-2017, Michael A. Updike All rights reserved.
 *  Licensed under the BSD-3-Clause
 *  https://opensource.org/licenses/BSD-3-Clause
 *  https://github.com/opus1269/photo-screen-saver/blob/master/LICENSE.md
 */
(function() {
  'use strict';
  window.app = window.app || {};

  new ExceptionHandler();

  /**
   * A Google Photo Album
   * @typedef {Object} app.GoogleSource.Album
   * @property {int} index - Array index
   * @property {string} uid - unique identifier
   * @property {string} name - album name
   * @property {string} id - Google album Id
   * @property {string} thumb - thumbnail url
   * @property {boolean} checked - is album selected
   * @property {int} ct - number of photos
   * @property {app.PhotoSource.SourcePhoto[]} photos - Array of photos
   * @memberOf app.GoogleSource
   */

  /**
   * A Selected Google Photo Album
   * @typedef {Object} app.GoogleSource.SelectedAlbum
   * @property {string} id - Google album Id
   * @property {app.PhotoSource.SourcePhoto[]} photos - Array of photos
   * @memberOf app.GoogleSource
   */

  /**
   * Path to Picasa API
   * @type {string}
   * @const
   * @default
   * @private
   * @memberOf app.GoogleSource
   */
  const _URL_BASE = 'https://picasaweb.google.com/data/feed/api/user/';

  /**
   * Query for list of albums
   * @type {string}
   * @const
   * @default
   * @private
   * @memberOf app.GoogleSource
   */
  const _ALBUMS_QUERY = '?max-results=2000&visibility=all&kind=album' +
      '&fields=entry(gphoto:albumType,gphoto:id)&v2&alt=json';

  /**
   * Query an album
   * @type {string}
   * @const
   * @default
   * @private
   * @memberOf app.GoogleSource
   */
  const _ALBUM_QUERY = '?imgmax=1600&thumbsize=72' +
      '&fields=title,gphoto:id,entry(media:group/media:content,' +
      'media:group/media:credit,media:group/media:thumbnail,georss:where)' +
      '&v=2&alt=json';

  /**
   * Query all photos
   * @type {string}
   * @const
   * @default
   * @private'
   * @memberOf app.GoogleSource
   */
  const _PHOTOS_QUERY = '?imgmax=1600' +
      '&fields=title,gphoto:id,entry(media:group/media:content,' +
      'media:group/media:credit,media:group/media:thumbnail,georss:where)' +
      '&v=2&alt=json';

  /**
   * A potential source of photos from Google
   * @alias app.GoogleSource
   */
  app.GoogleSource = class extends app.PhotoSource {

    /**
     * Create a new photo source
     * @param {string} useKey - The key for if the source is selected
     * @param {string} photosKey - The key for the collection of photos
     * @param {string} type - A descriptor of the photo source
     * @param {boolean} isDaily - Should the source be updated daily
     * @param {boolean} isArray - Is the source an Array of photo Arrays
     * @param {?Object} [loadArg=null] - optional arg for load function
     * @constructor
     */
    constructor(useKey, photosKey, type, isDaily, isArray, loadArg = null) {
      super(useKey, photosKey, type, isDaily, isArray, loadArg);
    }

    /** Determine if a Picasa entry is an image
     * @param {Object} entry - Picasa media object
     * @returns {boolean} true if entry is a photo
     * @private
     */
    static _isImage(entry) {
      const content = entry.media$group.media$content;
      for (let i = 0; i < content.length; i++) {
        if (content[i].medium !== 'image') {
          return false;
        }
      }
      return true;
    }

    /** Determine if a Picasa entry has Geo position
     * @param {Object} entry - Picasa media object
     * @returns {boolean} true if entry has Geo position
     * @private
     */
    static _hasGeo(entry) {
      return !!(entry.georss$where &&
      entry.georss$where.gml$Point &&
      entry.georss$where.gml$Point.gml$pos &&
      entry.georss$where.gml$Point.gml$pos.$t);
    }

    /** Get the thumbnail url if it exists
     * @param {Array} entry - Picasa media object
     * @returns {?string} url or null
     * @private
     */
    static _getThumbnail(entry) {
      let ret = null;
      if (entry.length &&
          entry[0].media$group &&
          entry[0].media$group.media$thumbnail[0]) {
        ret = entry[0].media$group.media$thumbnail[0].url;
      }
      return ret;
    }

    /**
     * Extract the Picasa photos into an Array
     * @param {Object} root - root object from Picasa API call
     * @returns {app.PhotoSource.SourcePhoto[]} Array of photos
     * @private
     */
    static _processPhotos(root) {
      const photos = [];
      if (root) {
        const feed = root.feed;
        const entries = feed.entry || [];
        for (const entry of entries) {
          if (app.GoogleSource._isImage(entry)) {
            const url = entry.media$group.media$content[0].url;
            const width = entry.media$group.media$content[0].width;
            const height = entry.media$group.media$content[0].height;
            const asp = width / height;
            const author = entry.media$group.media$credit[0].$t;
            let point;
            if (app.GoogleSource._hasGeo(entry)) {
              point = entry.georss$where.gml$Point.gml$pos.$t;
            }
            app.PhotoSource.addPhoto(photos, url, author, asp, {},
                point);
          }
        }
      }
      return photos;
    }

    /**
     * Retrieve a Google Photos album
     * @param {string} albumId - Picasa album ID
     * @param {string} [userId='default'] - userId for non-authenticated request
     * @returns {Promise<Object>} Root object from Picasa call null if not found
     * @private
     */
    static _loadPicasaAlbum(albumId, userId = 'default') {
      const url = `${_URL_BASE}${userId}/albumid/${albumId}/${_ALBUM_QUERY}`;
      if (userId === 'default') {
        const conf = Chrome.JSONUtils.shallowCopy(Chrome.Http.conf);
        conf.isAuth = true;
        return Chrome.Http.doGet(url, conf).catch((err) => {
          const statusMsg = `${Chrome.Locale.localize('err_status')}: 404`;
          if (err.message.includes(statusMsg)) {
            // album was probably deleted
            return Promise.resolve(null);
          } else {
            throw err;
          }
        });
      } else {
        return Chrome.Http.doGet(url);
      }
    }

    /**
     * Retrieve the users list of albums, including the photos in each
     * @param {boolean} interactive - true is user initiated call
     * @returns {Promise<app.GoogleSource.Album[]>} Array of albums
     */
    static loadAlbumList(interactive = false) {
      const url = `${_URL_BASE}default/${_ALBUMS_QUERY}`;

      // get list of albums
      const conf = Chrome.JSONUtils.shallowCopy(Chrome.Http.conf);
      conf.isAuth = true;
      conf.retryToken = true;
      conf.interactive = interactive;
      return Chrome.Http.doGet(url, conf).then((root) => {
        if (!root || !root.feed || !root.feed.entry) {
          throw new Error(Chrome.Locale.localize('err_no_albums'));
        }

        const feed = root.feed;

        // series of API calls to get each album
        const promises = [];
        const entries = feed.entry || [];
        for (const entry of entries) {
          if (!entry.gphoto$albumType) {
            // skip special albums (e.g. Google+ posts, backups)
            const albumId = entry.gphoto$id.$t;
            promises.push(app.GoogleSource._loadPicasaAlbum(albumId));
          }
        }

        // Collate the albums
        return Promise.all(promises);
      }).then((vals) => {
        /** @type {app.GoogleSource.Album[]} */
        let albums = [];
        let ct = 0;
        const values = vals || [];
        for (const value of values) {
          if (value !== null) {
            const feed = value.feed;
            if (feed && feed.entry) {
              const thumb = app.GoogleSource._getThumbnail(feed.entry);
              const photos = app.GoogleSource._processPhotos(value);
              if (photos && photos.length) {
                /** @type {app.GoogleSource.Album} */
                const album = {};
                album.index = ct;
                album.uid = 'album' + ct;
                album.name = feed.title.$t;
                album.id = feed.gphoto$id.$t;
                album.ct = photos.length;
                album.thumb = thumb;
                album.checked = false;
                album.photos = photos;
                albums.push(album);
                ct++;
              }
            }
          }
        }
        return Promise.resolve(albums);
      });
    }

    /**
     * Fetch the photos for the selected albums
     * @returns {Promise<app.PhotoSource.SourcePhoto[]>} Array of photos
     */
    static _fetchAlbumPhotos() {
      let vals = Chrome.Storage.get('albumSelections');

      // series of API calls to get each album
      const promises = [];
      const albums = vals || [];
      for (const album of albums) {
        promises.push(app.GoogleSource._loadPicasaAlbum(album.id));
      }

      // Collate the albums
      return Promise.all(promises).then((vals) => {
        /** @type {app.GoogleSource.SelectedAlbum[]} */
        const albums = [];
        const values = vals || [];
        for (const value of values) {
          if (value) {
            const feed = value.feed;
            const photos = app.GoogleSource._processPhotos(value);
            if (photos && photos.length) {
              albums.push({
                id: feed.gphoto$id.$t,
                photos: photos,
              });
            }
          }
        }
        return Promise.resolve(albums);
      });
    }

    /**
     * Fetch the photos for this source
     * @returns {Promise<app.PhotoSource.SourcePhoto[]>} Array of photos
     */
    fetchPhotos() {
      if (this._loadArg) {
        // albums
        return app.GoogleSource._fetchAlbumPhotos();
      } else {
        // photos
        // todo fetch photos
        return Promise.resolve([]);
      }
    }
  };
})();