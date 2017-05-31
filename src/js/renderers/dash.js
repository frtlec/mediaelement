'use strict';

import window from 'global/window';
import mejs from '../core/mejs';
import {renderer} from '../core/renderer';
import {createEvent, isString} from '../utils/general';
import {typeChecks} from '../utils/media';
import {HAS_MSE} from '../utils/constants';
import {loadScript} from '../utils/dom';

/**
 * Native M(PEG)-Dash renderer
 *
 * Uses dash.js, a reference client implementation for the playback of M(PEG)-DASH via Javascript and compliant browsers.
 * It relies on HTML5 video and MediaSource Extensions for playback.
 * This renderer integrates new events associated with mpd files.
 * @see https://github.com/Dash-Industry-Forum/dash.js
 *
 */
const NativeDash = {

	promise: null,

	/**
	 * Create a queue to prepare the loading of an DASH source
	 *
	 * @param {Object} settings - an object with settings needed to load an DASH player instance
	 */
	load: (settings) => {
		if (typeof dashjs !== 'undefined') {
			NativeDash.promise = new Promise(() => {
				NativeDash._createPlayer(settings);
			});
		} else if (!NativeDash.promise) {
			settings.options.path = typeof settings.options.path === 'string' ?
				settings.options.path : 'https://cdn.dashjs.org/latest/dash.all.min.js';

			NativeDash.promise = NativeDash.promise || loadScript(settings.options.path);
			NativeDash.promise.then(() => {
				NativeDash._createPlayer(settings);
			});
		}

		return NativeDash.promise;
	},

	/**
	 * Create a new instance of DASH player and trigger a custom event to initialize it
	 *
	 * @param {Object} settings - an object with settings needed to instantiate DASH object
	 */
	_createPlayer: (settings) => {
		const player = dashjs.MediaPlayer().create();
		window['__ready__' + settings.id](player);
	}
};

const DashNativeRenderer = {
	name: 'native_dash',
	options: {
		prefix: 'native_dash',
		dash: {
			// Special config: used to set the local path/URL of dash.js player library
			path: 'https://cdn.dashjs.org/latest/dash.all.min.js',
			debug: false,
			drm: {},
			// Robustness level for video and audio capabilities.
			// Possible values: SW_SECURE_CRYPTO, SW_SECURE_DECODE, HW_SECURE_CRYPTO, HW_SECURE_CRYPTO, HW_SECURE_DECODE, HW_SECURE_ALL
			robustnessLevel: ''
		}
	},
	/**
	 * Determine if a specific element type can be played with this render
	 *
	 * @param {String} type
	 * @return {Boolean}
	 */
	canPlayType: (type) => HAS_MSE && ['application/dash+xml'].indexOf(type.toLowerCase()) > -1,

	/**
	 * Create the player instance and add all native events/methods/properties as possible
	 *
	 * @param {MediaElement} mediaElement Instance of mejs.MediaElement already created
	 * @param {Object} options All the player configuration options passed through constructor
	 * @param {Object[]} mediaFiles List of sources with format: {src: url, type: x/y-z}
	 * @return {Object}
	 */
	create: (mediaElement, options, mediaFiles) => {

		const
			originalNode = mediaElement.originalNode,
			id = mediaElement.id + '_' + options.prefix,
			autoplay = originalNode.autoplay
		;

		let
			node = null,
			dashPlayer = null
		;

		node = originalNode.cloneNode(true);
		options = Object.assign(options, mediaElement.options);

		const
			props = mejs.html5media.properties,
			assignGettersSetters = (propName) => {
				const capName = `${propName.substring(0, 1).toUpperCase()}${propName.substring(1)}`;

				node[`get${capName}`] = () => (dashPlayer !== null) ? node[propName] : null;

				node[`set${capName}`] = (value) => {
					if (mejs.html5media.readOnlyProperties.indexOf(propName) === -1) {
						if (propName === 'src') {
							if (typeof value === 'string') {
								node[propName] = value;
								if (dashPlayer !== null) {
									dashPlayer.attachSource(value);
									if (autoplay) {
										dashPlayer.play();
									}
								}
							} else if (value && typeof value === 'object' && value.src) {
								node[propName] = value.src;
								if (dashPlayer !== null) {
									// If DRM is set, load protection data
									if (value && typeof value === 'object' && typeof value.drm === 'object') {
										dashPlayer.setProtectionData(value.drm);
										if (isString(options.dash.robustnessLevel) && options.dash.robustnessLevel) {
											dashPlayer.getProtectionController().setRobustnessLevel(options.dash.robustnessLevel);
										}
									}
									dashPlayer.attachSource(value.src);
									if (autoplay) {
										dashPlayer.play();
									}
								}
							}
						} else {
							node[propName] = value;
						}
					}
				};
			}
		;

		for (let i = 0, total = props.length; i < total; i++) {
			assignGettersSetters(props[i]);
		}

		// Initial method to register all M(PEG)-DASH events
		window['__ready__' + id] = (_dashPlayer) => {
			mediaElement.dashPlayer = dashPlayer = _dashPlayer;

			const
				events = mejs.html5media.events.concat(['click', 'mouseover', 'mouseout']),
				dashEvents = dashjs.MediaPlayer.events,
				assignEvents = (eventName) => {
					if (eventName === 'loadedmetadata') {
						// Basic configuration
						dashPlayer.getDebug().setLogToBrowserConsole(options.dash.debug);
						dashPlayer.initialize();
						dashPlayer.setScheduleWhilePaused(false);
						dashPlayer.setFastSwitchEnabled(true);
						dashPlayer.attachView(node);
						dashPlayer.setAutoPlay(false);

						// If DRM is set, load protection data
						if (typeof options.dash.drm === 'object' && !mejs.Utils.isObjectEmpty(options.dash.drm)) {
							dashPlayer.setProtectionData(options.dash.drm);
							if (isString(options.dash.robustnessLevel) && options.dash.robustnessLevel) {
								dashPlayer.getProtectionController()
								.setRobustnessLevel(options.dash.robustnessLevel);
							}
						}
						dashPlayer.attachSource(node.getSrc());
					}

					node.addEventListener(eventName, (e) => {
						const event = createEvent(e.type, mediaElement);
						mediaElement.dispatchEvent(event);
					});
				}
			;

			for (let i = 0, total = events.length; i < total; i++) {
				assignEvents(events[i]);
			}

			/**
			 * Custom M(PEG)-DASH events
			 *
			 * These events can be attached to the original node using addEventListener and the name of the event,
			 * not using dashjs.MediaPlayer.events object
			 * @see http://cdn.dashjs.org/latest/jsdoc/MediaPlayerEvents.html
			 */
			const assignMdashEvents = (e) => {
				const event = createEvent(e.type, node);
				event.data = e;
				mediaElement.dispatchEvent(event);

				if (e.type.toLowerCase() === 'error') {
					console.error(e);
				}
			};

			for (const eventType in dashEvents) {
				if (dashEvents.hasOwnProperty(eventType)) {
					dashPlayer.on(dashEvents[eventType], assignMdashEvents);
				}
			}
		};

		if (mediaFiles && mediaFiles.length > 0) {
			for (let i = 0, total = mediaFiles.length; i < total; i++) {
				if (renderer.renderers[options.prefix].canPlayType(mediaFiles[i].type)) {
					node.setAttribute('src', mediaFiles[i].src);
					if (typeof mediaFiles[i].drm !== 'undefined') {
						options.dash.drm = mediaFiles[i].drm;
					}
					break;
				}
			}
		}

		node.setAttribute('id', id);

		originalNode.parentNode.insertBefore(node, originalNode);
		originalNode.autoplay = false;
		originalNode.style.display = 'none';

		node.setSize = (width, height) => {
			node.style.width = `${width}px`;
			node.style.height = `${height}px`;
			return node;
		};

		node.hide = () => {
			node.pause();
			node.style.display = 'none';
			return node;
		};

		node.show = () => {
			node.style.display = '';
			return node;
		};

		const event = createEvent('rendererready', node);
		mediaElement.dispatchEvent(event);

		mediaElement.promises.push(NativeDash.load({
			options: options.dash,
			id: id
		}));

		return node;
	}
};

/**
 * Register Native M(PEG)-Dash type based on URL structure
 *
 */
typeChecks.push((url) => ~(url.toLowerCase()).indexOf('.mpd') ? 'application/dash+xml' : null);

renderer.add(DashNativeRenderer);