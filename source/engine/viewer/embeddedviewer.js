import { IsDefined } from '../core/core.js';
import { Direction } from '../geometry/geometry.js';
import { InputFilesFromFileObjects, InputFilesFromUrls } from '../import/importerfiles.js';
import { ImportErrorCode, ImportSettings } from '../import/importer.js';
import { TransformFileHostUrls } from '../io/fileutils.js';
import { ParameterConverter } from '../parameters/parameterlist.js';
import { ThreeModelLoader } from '../threejs/threemodelloader.js';
import { Viewer } from './viewer.js';

/** ------------------------------------------------------------------------------------------------
 * This is the main object for embedding the viewer on a website.
 */
export class EmbeddedViewer
{
    /** --------------------------------------------------------------------------------------------
     * @param {Element} parentElement The parent element for the viewer canvas. It must be an
     * existing DOM element and it will be the container for the viewer. The size of the viewer will
     * be automatically adjusted to the size of the parent element.
     * @param {Object} parameters Parameters for embedding.
     * @param {Camera} [parameters.camera] Camera to use. If not specified, the default camera will
     * be used and the model will be fitted to the window.
     * @param {CameraMode} [parameters.cameraMode] Either CameraMode.Perspective or
     * CameraMode.Orthographic. The default is perspective.
     * @param {RGBAColor} [parameters.backgroundColor] Background color of the canvas.
     * @param {RGBColor} [parameters.defaultColor] Default color of the model. It has effect only
     * if the imported model doesn't specify any color.
     * @param {Object} [parameters.edgeSettings] Edge settings.
     * @param {Boolean} [parameters.edgeSettings.showEdges] Show edges.
     * @param {RGBColor} [parameters.edgeSettings.edgeColor] Color of the edges.
     * @param {Number} [parameters.edgeSettings.edgeThreshold] Minimum angle between faces to show
     * edges between them.
     * @param {Object} [parameters.environmentSettings] Environment settings.
     * @param {String[]} [parameters.environmentSettings.environmentMap] Urls of the environment map
     * images in this order: posx, negx, posy, negy, posz, negz.
     * @param {Boolean} [parameters.environmentSettings.backgroundIsEnvMap] Use background as
     * environment map.
     * @param {Function} [parameters.onModelLoaded] Callback that is called when to model with all
     * of the textures is fully loaded.
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

    /** --------------------------------------------------------------------------------------------
     * Loads the model based on a list of urls. The list must contain the main model file and all
     * of the referenced files. For example in case of an obj file the list must contain the
     * corresponding mtl and texture files, too.
     * @param {String[]} modelUrls Url list of model files.
     */
    LoadModelFromUrlList (modelUrls)
    {
        TransformFileHostUrls (modelUrls);
        let inputFiles = InputFilesFromUrls (modelUrls);
        this.LoadModelFromInputFiles (inputFiles);
    }

    /** --------------------------------------------------------------------------------------------
     * Loads the model based on a file list. The list must contain the main model file and all of
     * the referenced files. You must use this method used when you are using a file picker to
     * select files from your computer.
     * @param {File[]} fileList File Object list of model files.
     */
    LoadModelFromFileList (fileList)
    {
        let inputFiles = InputFilesFromFileObjects (fileList);
        this.LoadModelFromInputFiles (inputFiles);
    }

    /** --------------------------------------------------------------------------------------------
     * Loads the model based on a list of {@link InputFile} objects. This method is used
     * internally, you should use [LoadModelFromUrlList]{@link EmbeddedViewer#LoadModelFromUrlList}
     * or [LoadModelFromFileList]{@link EmbeddedViewer#LoadModelFromFileList} instead.
     * @param {InputFile[]} inputFiles List of model files.
     */
    LoadModelFromInputFiles (inputFiles)
    {
        if (inputFiles === null || inputFiles.length === 0) {
            return;
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

    /** --------------------------------------------------------------------------------------------
     * Returns the underlying Viewer object.
     * @returns {Viewer} The Viewer object.
     */
    GetViewer ()
    {
        return this.viewer;
    }

    /** --------------------------------------------------------------------------------------------
     * Returns the underlying Model object.
     * @returns {Model} The Model object.
     */
    GetModel ()
    {
        return this.model;
    }

    /** --------------------------------------------------------------------------------------------
     * This method must be called when the size of the parent element changes to make sure that the
     * context has the same dimensions as the parent element.
     */
    Resize ()
    {
        let width = this.parentElement.clientWidth;
        let height = this.parentElement.clientHeight;
        this.viewer.Resize (width, height);
    }

    Destroy ()
    {
        this.modelLoader.Destroy ();
        this.viewer.Destroy ();
        this.model = null;
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
