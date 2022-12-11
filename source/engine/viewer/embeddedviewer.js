import { IsDefined } from '../core/core.js';
import { Direction } from '../geometry/geometry.js';
import { InputFilesFromFileObjects, InputFilesFromUrls } from '../import/importerfiles.js';
import { ImportErrorCode, ImportSettings } from '../import/importer.js';
import { TransformFileHostUrls } from '../io/fileutils.js';
import { ParameterConverter } from '../parameters/parameterlist.js';
import { ThreeModelLoader } from '../threejs/threemodelloader.js';
import { Viewer } from './viewer.js';

/**
 * This is the main entry point for embedding the viewer on a website.
 *
 */
export class EmbeddedViewer
{
    /**
     * @param {*} parentElement The parent element for the viewer canvas. It must be an existing
     * DOM element element and it will be the container for the viewer. The size of the viewer
     * will be automatically adjusted to the size of the parent element.
     * @param {*} parameters Parameter object for embedding.
     * - camera ({@link Camera}): Camera properties to use. If not specified, the default camera will be used and
     * the model will be fitted to the window.
     * - cameraMode ({@link CameraMode}): Either CameraMode.Perspective or CameraMode.Orthographic. The
     * default is perspective.
     * - backgroundColor ({@link RGBAColor}): Background color of the canvas.
     * - defaultColor ({@link RGBColor}): Default color of the model. It has effect only if the imported model
     * doesn't specify any color.
     * - edgeSettings (Object):
     *   - showEdges (Boolean): Show edges.
     *   - edgeColor ({@link RGBColor}): Color of the edges.
     *   - edgeThreshold (Number): Minimum angle between faces to show edges between them.
     * - environmentSettings (Object):
     *   - environmentMap (String[]): Urls of the environment map images in this order: posx, negx, posy, negy, posz, negz.
     *   - backgroundIsEnvMap (Boolean): Use background as environment map.
     * - onModelLoaded (Function): Callback that is called when to model is fully loaded.
     */
    constructor (parentElement, parameters)
    {
        this.parentElement = parentElement;
        this.parameters = {};
        if (IsDefined (parameters)) {
            this.parameters = parameters;
        }

        this.canvas = document.createElement ('canvas');
        this.parentElement.appendChild (this.canvas);

        this.viewer = new Viewer ();
        this.viewer.Init (this.canvas);

        let width = this.parentElement.clientWidth;
        let height = this.parentElement.clientHeight;
        this.viewer.Resize (width, height);

        if (this.parameters.cameraMode) {
            this.viewer.SetCameraMode (this.parameters.cameraMode);
        }

        if (this.parameters.backgroundColor) {
            this.viewer.SetBackgroundColor (this.parameters.backgroundColor);
        }

        if (this.parameters.edgeSettings) {
            this.viewer.SetEdgeSettings (
                this.parameters.edgeSettings.showEdges,
                this.parameters.edgeSettings.edgeColor,
                this.parameters.edgeSettings.edgeThreshold
            );
        }

        if (this.parameters.environmentSettings) {
            let environmentMap = this.parameters.environmentSettings.environmentMap;
            let backgroundIsEnvMap = this.parameters.environmentSettings.backgroundIsEnvMap;
            this.viewer.SetEnvironmentMapSettings (environmentMap, backgroundIsEnvMap);
        }

        this.model = null;
        this.modelLoader = new ThreeModelLoader ();

        window.addEventListener ('resize', () => {
            this.Resize ();
        });
    }

    /**
     * Loads the model based on the given urls.
     * @param {String[]} modelUrls Urls of all files connected to the object.
     */
    LoadModelFromUrlList (modelUrls)
    {
        TransformFileHostUrls (modelUrls);
        let inputFiles = InputFilesFromUrls (modelUrls);
        this.LoadModelFromInputFiles (inputFiles);
    }

    LoadModelFromFileList (fileList)
    {
        let inputFiles = InputFilesFromFileObjects (fileList);
        this.LoadModelFromInputFiles (inputFiles);
    }

    LoadModelFromInputFiles (inputFiles)
    {
        if (inputFiles === null || inputFiles.length === 0) {
            return null;
        }

        this.viewer.Clear ();
        let settings = new ImportSettings ();
        if (this.parameters.defaultColor) {
            settings.defaultColor = this.parameters.defaultColor;
        }

        this.model = null;
        let progressDiv = null;
        this.modelLoader.LoadModel (inputFiles, settings, {
            onLoadStart : () => {
                this.canvas.style.display = 'none';
                progressDiv = document.createElement ('div');
                progressDiv.innerHTML = 'Loading model...';
                this.parentElement.appendChild (progressDiv);
            },
            onFileListProgress : (current, total) => {
            },
            onFileLoadProgress : (current, total) => {
            },
            onImportStart : () => {
                progressDiv.innerHTML = 'Importing model...';
            },
            onVisualizationStart : () => {
                progressDiv.innerHTML = 'Visualizing model...';
            },
            onModelFinished : (importResult, threeObject) => {
                this.parentElement.removeChild (progressDiv);
                this.canvas.style.display = 'inherit';
                this.viewer.SetMainObject (threeObject);
                let boundingSphere = this.viewer.GetBoundingSphere ((meshUserData) => {
                    return true;
                });
                this.viewer.AdjustClippingPlanesToSphere (boundingSphere);
                if (this.parameters.camera) {
                    this.viewer.SetCamera (this.parameters.camera);
                } else {
                    this.viewer.SetUpVector (Direction.Y, false);
                    this.viewer.FitSphereToWindow (boundingSphere, false);
                }

                this.model = importResult.model;
                if (this.parameters.onModelLoaded) {
                    this.parameters.onModelLoaded ();
                }
            },
            onTextureLoaded : () => {
                this.viewer.Render ();
            },
            onLoadError : (importError) => {
                let message = 'Unknown error.';
                if (importError.code === ImportErrorCode.NoImportableFile) {
                    message = 'No importable file found.';
                } else if (importError.code === ImportErrorCode.FailedToLoadFile) {
                    message = 'Failed to load file for import.';
                } else if (importError.code === ImportErrorCode.ImportFailed) {
                    message = 'Failed to import model.';
                }
                if (importError.message !== null) {
                    message += ' (' + importError.message + ')';
                }
                progressDiv.innerHTML = message;
            }
        });
    }

    GetViewer ()
    {
        return this.viewer;
    }

    GetModel ()
    {
        return this.model;
    }

    Resize ()
    {
        let width = this.parentElement.clientWidth;
        let height = this.parentElement.clientHeight;
        this.viewer.Resize (width, height);
    }
}

export function Init3DViewerElement (parentElement, modelUrls, parameters)
{
    let viewer = new EmbeddedViewer (parentElement, parameters);
    viewer.LoadModelFromUrlList (modelUrls);
    return viewer;
}

export function Init3DViewerElements (onReady)
{
    function LoadElement (element)
    {
        let camera = null;
        let cameraParams = element.getAttribute ('camera');
        if (cameraParams) {
            camera = ParameterConverter.StringToCamera (cameraParams);
        }

        let cameraMode = null;
        let cameraModeParams = element.getAttribute ('cameramode');
        if (cameraModeParams) {
            cameraMode = ParameterConverter.StringToCameraMode (cameraModeParams);
        }

        let backgroundColor = null;
        let backgroundColorParams = element.getAttribute ('backgroundcolor');
        if (backgroundColorParams) {
            backgroundColor = ParameterConverter.StringToRGBAColor (backgroundColorParams);
        }

        let defaultColor = null;
        let defaultColorParams = element.getAttribute ('defaultcolor');
        if (defaultColorParams) {
            defaultColor = ParameterConverter.StringToRGBColor (defaultColorParams);
        }

        let edgeSettings = null;
        let edgeSettingsParams = element.getAttribute ('edgesettings');
        if (edgeSettingsParams) {
            edgeSettings = ParameterConverter.StringToEdgeSettings (edgeSettingsParams);
        }

        let environmentSettings = null;
        let environmentMapParams = element.getAttribute ('environmentmap');
        if (environmentMapParams) {
            let environmentMapParts = environmentMapParams.split (',');
            if (environmentMapParts.length === 6) {
                let backgroundIsEnvMap = false;
                let backgroundIsEnvMapParam = element.getAttribute ('environmentmapbg');
                if (backgroundIsEnvMapParam && backgroundIsEnvMapParam === 'true') {
                    backgroundIsEnvMap = true;
                }
                environmentSettings = {
                    environmentMap : environmentMapParts,
                    backgroundIsEnvMap : backgroundIsEnvMap
                };
            }
        }

        let modelUrls = null;
        let modelParams = element.getAttribute ('model');
        if (modelParams) {
            modelUrls = ParameterConverter.StringToModelUrls (modelParams);
        }

        return Init3DViewerElement (element, modelUrls, {
            camera : camera,
            cameraMode : cameraMode,
            backgroundColor : backgroundColor,
            defaultColor : defaultColor,
            edgeSettings : edgeSettings,
            environmentSettings : environmentSettings
        });
    }

    let viewerElements = [];
    window.addEventListener ('load', () => {
        let elements = document.getElementsByClassName ('online_3d_viewer');
        for (let i = 0; i < elements.length; i++) {
            let element = elements[i];
            let viewerElement = LoadElement (element);
            viewerElements.push (viewerElement);
        }
        if (onReady !== undefined && onReady !== null) {
            onReady (viewerElements);
        }
    });
}
