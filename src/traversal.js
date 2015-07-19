var errorUtil = require('./errorUtil'),
    stringUtil = require('./stringUtil'),
    ylcBindParser = require('./parser/ylcBind'),
    domTemplates = require('./domTemplates'),
    ylcEventsParser = require('./parser/ylcEvents'),
    ylcLoopParser = require('./parser/ylcLoop'),
    domAnnotator = require('./domAnnotator');

module.exports = (function () {

    var EMPTY_FUNCTION = function () {},
        PREFIELD = {};

    function v2mSetValues(context, domView, domElement) {

        var jqElement = $(domElement),
            strYlcBind = stringUtil.strGetData(jqElement, "ylcBind"),
            arrYlcBind = ylcBindParser.parseYlcBind(strYlcBind),
            idxYlcBind,
            currentYlcBinding,
            fnGetter,
            value,
            forceSet;

        for (idxYlcBind = 0; idxYlcBind < arrYlcBind.length; idxYlcBind += 1) {
            currentYlcBinding = arrYlcBind[idxYlcBind];

            if (currentYlcBinding.strMappingOperator !== ylcBindParser.MAPPING_BIDIRECTIONAL &&
                currentYlcBinding.strMappingOperator !== ylcBindParser.MAPPING_V2M_ONLY &&
                currentYlcBinding.strMappingOperator !== ylcBindParser.MAPPING_V2M_ONLY_FORCED) {
                continue;
            }

            forceSet = currentYlcBinding.strMappingOperator === ylcBindParser.MAPPING_V2M_ONLY_FORCED;

            if (stringUtil.isEmpty(currentYlcBinding.strPropertyName)) {
                value = jqElement.get();

            } else {
                fnGetter = jqElement[currentYlcBinding.strPropertyName];

                if (!fnGetter instanceof Function) {
                    throw errorUtil.createError(
                        "Cannot find jQuery getter/setter called '" +
                        currentYlcBinding.strPropertyName + "'.",
                        domView
                    );
                }

                if (currentYlcBinding.strSubpropertyName === undefined) {
                    value = fnGetter.call(jqElement);
                } else {
                    value = fnGetter.call(jqElement, currentYlcBinding.strSubpropertyName);
                }
            }

            try {
                context.setValue(currentYlcBinding.strBindingExpression, value, forceSet);

            } catch (err) {
                throw errorUtil.elementToError(err, domElement);
            }
        }
    }

    function getGeneratedElements(jqTemplate) {
        var domarrResult = [],
            jqCurrentSibling;

        jqCurrentSibling = jqTemplate;

        while (true) {
            jqCurrentSibling = jqCurrentSibling.next();

            if (jqCurrentSibling.get() === undefined || !domTemplates.isDynamicallyGenerated(jqCurrentSibling)) {
                break;
            }

            domarrResult.push(jqCurrentSibling.get());
        }

        return domarrResult;
    }

    function checkIterable(arrCollection) {
        if (!(arrCollection instanceof Array)) {
            throw errorUtil.createError(
                "Attempt to iterate through a non-array value: " +
                arrCollection
            );
        }
    }

    function v2mProcessDynamicElements(
        context,
        domView,
        jqTemplate,
        controller
    ) {

        var strYlcLoop = stringUtil.strGetData(jqTemplate, "ylcLoop"),
            strYlcIf = stringUtil.strGetData(jqTemplate, "ylcIf");

        if (strYlcLoop && strYlcIf) {
            throw errorUtil.createError(
                "An element contains both data-ylcLoop and data-ylcIf.",
                jqTemplate.get()
            );
        }

        if (strYlcLoop) {
            return v2mProcessDynamicLoopElements(
                context,
                domView,
                jqTemplate,
                controller
            );
        }

        if (strYlcIf) {
            return v2mProcessDynamicIfElements(
                context,
                domView,
                jqTemplate,
                controller
            );
        }

        errorUtil.assert(false);

    }

    function v2mProcessElement(context, domView, domElement, controller) {
        var nElementsProcessed;

        if (domTemplates.isTemplate(domElement)) {
            nElementsProcessed = v2mProcessDynamicElements(
                context,
                domView,
                $(domElement),
                controller
            );

        } else if (domElement !== domView && domAnnotator.isViewRoot($(domElement))) {
            nElementsProcessed = 1;

        } else {
            v2mSetValues(context, domView, domElement);
            v2mProcessChildren(context, domView, domElement, controller);
            nElementsProcessed = 1;
        }

        return nElementsProcessed;
    }

    function v2mProcessDynamicLoopElements(
        context,
        domView,
        jqTemplate,
        controller
    ) {
        var idxWithinDynamicallyGenerated,
            ylcLoop = ylcLoopParser.parseYlcLoop(stringUtil.strGetData(jqTemplate, "ylcLoop")),
            arrCollection = context.getValue(ylcLoop.strCollectionName),
            domarrGeneratedElements = getGeneratedElements(jqTemplate),
            domDynamicallyGeneratedElement,
            nProcessed;

        checkIterable(arrCollection);

        for (idxWithinDynamicallyGenerated = 0;
             idxWithinDynamicallyGenerated < domarrGeneratedElements.length;
             idxWithinDynamicallyGenerated += 1) {

            domDynamicallyGeneratedElement =
                domarrGeneratedElements[idxWithinDynamicallyGenerated];

            context.enterIteration(
                ylcLoop.strLoopVariable,
                arrCollection,
                ylcLoop.strStatusVariable,
                idxWithinDynamicallyGenerated
            );

            nProcessed =
                v2mProcessElement(
                    context,
                    domView,
                    domDynamicallyGeneratedElement,
                    controller
                );
            errorUtil.assert(
                nProcessed === 1,
                "A template can't be a dynamically generated element."
            );

            context.exitIteration(
                ylcLoop.strLoopVariable,
                ylcLoop.strStatusVariable
            );
        }

        return domarrGeneratedElements.length + 1;
    }

    function v2mProcessDynamicIfElements(
        context,
        domView,
        jqTemplate,
        controller
    ) {
        var domarrCurrentGeneratedElements = getGeneratedElements(jqTemplate);

        if (domarrCurrentGeneratedElements.length > 0) {
            errorUtil.assert(domarrCurrentGeneratedElements.length === 1);
            v2mProcessElement(
                context,
                domView,
                domarrCurrentGeneratedElements[0],
                controller
            );
        }

        return domarrCurrentGeneratedElements.length + 1;
    }

    function v2mProcessChildren(context, domView, domElement, controller) {
        var jqDomElement = $(domElement),
            jqsetChildren = jqDomElement.children(),
            index = 0,
            domChild;

        while (index < jqsetChildren.length) {
            domChild = jqsetChildren[index];
            index += v2mProcessElement(context, domView, domChild, controller);
        }
    }


    // propagating changes of model into view

    function m2vSetValues(context, domElement) {
        var jqElement = $(domElement),
            strYlcBind = stringUtil.strGetData(jqElement, "ylcBind"),
            arrYlcBind = ylcBindParser.parseYlcBind(strYlcBind),

            index,
            currentYlcBinding,
            fnSetter,
            value;

        for (index = 0; index < arrYlcBind.length; index += 1) {
            currentYlcBinding = arrYlcBind[index];

            if (currentYlcBinding.strMappingOperator !== ylcBindParser.MAPPING_BIDIRECTIONAL &&
                currentYlcBinding.strMappingOperator !== ylcBindParser.MAPPING_M2V_ONLY) {
                continue;
            }

            // an empty property maps straight to the DOM element, which is read only
            if (stringUtil.isEmpty(currentYlcBinding.strPropertyName)) {
                continue;
            }

            fnSetter = jqElement[currentYlcBinding.strPropertyName];
            if (!(fnSetter instanceof Function)) {
                throw errorUtil.createError(
                    "Cannot find jQuery getter/setter called '" +
                    currentYlcBinding.strPropertyName + "'.",
                    domElement
                );
            }

            try {
                value = context.getValue(currentYlcBinding.strBindingExpression);

            } catch (err) {
                throw errorUtil.elementToError(err, domElement);
            }

            if (value !== PREFIELD) {
                if (currentYlcBinding.strSubpropertyName === undefined) {
                    fnSetter.call(jqElement, value);

                } else {
                    fnSetter.call(jqElement, currentYlcBinding.strSubpropertyName, value);
                }
            }

        }

    }

    function processCommonElements(
        context,
        domView,
        controller,
        ylcLoop,
        domarrCurrentGeneratedElements,
        arrCollection,
        commonLength
    ) {
        var index = 0,
            domGeneratedElement;

        while (index < commonLength) {
            domGeneratedElement = domarrCurrentGeneratedElements[index];

            context.enterIteration(
                ylcLoop.strLoopVariable,
                arrCollection,
                ylcLoop.strStatusVariable,
                index
            );

            index +=
                m2vProcessElement(
                    context,
                    domView,
                    domGeneratedElement,
                    controller,
                    false
                );

            context.exitIteration(ylcLoop.strLoopVariable, ylcLoop.strStatusVariable);
        }
    }

    function addExtraElements(
        context,
        domView,
        controller,
        ylcLoop,
        jqTemplate,
        domarrCurrentGeneratedElements,
        arrCollection,
        commonLength
    ) {

        var jqLastCommonElement,
            jqLastElement,

            index,
            jqNewDynamicElement,
            elementsProcessed;

        if (commonLength === 0) {
            jqLastCommonElement = jqTemplate;
        } else {
            jqLastCommonElement = $(domarrCurrentGeneratedElements[commonLength - 1]);
        }

        jqLastElement = jqLastCommonElement;
        for (index = commonLength; index < arrCollection.length; index += 1) {

            jqNewDynamicElement = domTemplates.jqCreateElementFromTemplate(jqTemplate);

            context.enterIteration(
                ylcLoop.strLoopVariable,
                arrCollection,
                ylcLoop.strStatusVariable,
                index
            );

            elementsProcessed =
                m2vProcessElement(context, domView, jqNewDynamicElement.get(), controller, true);
            errorUtil.assert(
                elementsProcessed === 1,
                "If an element is dynamically generated, it can't be a template."
            );

            context.exitIteration(ylcLoop.strLoopVariable, ylcLoop.strStatusVariable);

            jqLastElement.after(jqNewDynamicElement);
            jqLastElement = jqNewDynamicElement;

        }
    }

    function m2vProcessDynamicLoopElements(
        context,
        domView,
        jqTemplate,
        controller,
        strYlcLoop
    ) {

        var ylcLoop = ylcLoopParser.parseYlcLoop(strYlcLoop),
            domarrCurrentGeneratedElements =
                getGeneratedElements(jqTemplate),
            arrCollection = context.getValue(ylcLoop.strCollectionName),
            commonLength,
            idxFirstToDelete,
            index;

        checkIterable(arrCollection);

        commonLength =
            Math.min(arrCollection.length, domarrCurrentGeneratedElements.length);

        processCommonElements(
            context,
            domView,
            controller,
            ylcLoop,
            domarrCurrentGeneratedElements,
            arrCollection,
            commonLength
        );

        if (arrCollection.length > commonLength) {
            addExtraElements(
                context,
                domView,
                controller,
                ylcLoop,
                jqTemplate,
                domarrCurrentGeneratedElements,
                arrCollection,
                commonLength
            );
        }

        if (domarrCurrentGeneratedElements.length > commonLength) {
            idxFirstToDelete = arrCollection.length;
            for (index = idxFirstToDelete;
                 index < domarrCurrentGeneratedElements.length;
                 index += 1) {
                $(domarrCurrentGeneratedElements[index]).remove();
            }
        }

        return domarrCurrentGeneratedElements.length + 1;
    }

    function m2vProcessDynamicIfElements(
        context,
        domView,
        jqTemplate,
        controller,
        strYlcIf
    ) {
        var ifExpressionValue = context.getValue(stringUtil.normalizeWhitespace(strYlcIf)),
            domarrCurrentGeneratedElements = getGeneratedElements(jqTemplate),
            jqNewDynamicElement,
            nElementsProcessed;

        if (ifExpressionValue && domarrCurrentGeneratedElements.length === 0) {
            jqNewDynamicElement = domTemplates.jqCreateElementFromTemplate(jqTemplate);

            nElementsProcessed =
                m2vProcessElement(context, domView, jqNewDynamicElement.get(), controller, true);
            errorUtil.assert(
                nElementsProcessed === 1,
                "If an element is dynamically generated, it can't be a template."
            );

            jqTemplate.after(jqNewDynamicElement);

        } else if (domarrCurrentGeneratedElements.length > 0) {
            if (ifExpressionValue) {
                nElementsProcessed =
                    m2vProcessElement(
                        context,
                        domView,
                        domarrCurrentGeneratedElements[0],
                        controller,
                        false
                    );

            } else {
                errorUtil.assert(domarrCurrentGeneratedElements.length === 1);
                $(domarrCurrentGeneratedElements[0]).remove();
            }

        }

        return domarrCurrentGeneratedElements.length + 1;

    }

    function m2vProcessDynamicElements(
        context,
        domView,
        jqTemplate,
        controller
    ) {

        var strYlcLoop = stringUtil.strGetData(jqTemplate, "ylcLoop"),
            strYlcIf = stringUtil.strGetData(jqTemplate, "ylcIf");

        if (strYlcLoop && strYlcIf) {
            throw errorUtil.createError(
                "An element can't contain both data-ylcLoop and data-ylcIf. " +
                "Please use an embedded DIV.",
                jqTemplate.get()
            );
        }

        if (strYlcLoop) {
            return m2vProcessDynamicLoopElements(
                context,
                domView,
                jqTemplate,
                controller,
                strYlcLoop
            );
        }

        if (strYlcIf) {
            return m2vProcessDynamicIfElements(
                context,
                domView,
                jqTemplate,
                controller,
                strYlcIf
            );
        }

        errorUtil.assert(false);
    }

    function m2vProcessChildren(
        context,
        domView,
        domElement,
        controller,
        bBindEvents
    ) {

        var jqElement = $(domElement),
            jqsetChildren = jqElement.children(),

            index,
            domChild;

        index = 0;

        while (index < jqsetChildren.length) {
            domChild = jqsetChildren[index];

            try {

                index +=
                    m2vProcessElement(
                        context,
                        domView,
                        domChild,
                        controller,
                        bBindEvents
                    );

            } catch (err) {
                throw errorUtil.elementToError(err, domChild);
            }
        }

    }

    function callModelUpdatingMethod(
        context,
        publicContext,
        domView,
        controller,
        fnUpdateMethod,
        m2vOnly
    ) {

        var returnValue;

        try {

            if (!m2vOnly) {
                v2mProcessElement(
                    context.newWithEmptyLoopVariables(),
                    domView,
                    domView,
                    controller
                );
            }

            returnValue = fnUpdateMethod.call(controller, context.getModel(), publicContext);

            m2vProcessElement(
                context.newWithEmptyLoopVariables(),
                domView,
                domView,
                controller,
                false
            );

        } catch (error) {
            errorUtil.printAndRethrow(error);
        }

        return returnValue;

    }



    function createHandler(context, publicContext, domView, controller, fnHandler, m2vOnly) {
        return function (eventObject) {
            publicContext.eventObject = eventObject;
            return callModelUpdatingMethod(
                context,
                publicContext,
                domView,
                controller,
                fnHandler,
                m2vOnly
            );
        };
    }

    function m2vBindEvents(context, domView, domElement, controller) {
        var jqElement = $(domElement),
            strYlcEvents = stringUtil.strGetData(jqElement, "ylcEvents"),
            arrYlcEvents = ylcEventsParser.parseYlcEvents(strYlcEvents),

            index,
            currentYlcEvent,
            fnHandler,
            publicContext,
            annotatedControllerFunction,

            m2vOnly;

        for (index = 0; index < arrYlcEvents.length; index += 1) {
            currentYlcEvent = arrYlcEvents[index];
            m2vOnly = false;

            if (currentYlcEvent.strMethodName.length === 0) {
                fnHandler = EMPTY_FUNCTION;

            } else {
                annotatedControllerFunction =
                    context.getControllerFunctionWithMetadata(currentYlcEvent.strMethodName);
                if (annotatedControllerFunction) {
                    fnHandler = annotatedControllerFunction.code;
                    if (annotatedControllerFunction.metadata.m2vOnly) {
                        m2vOnly = true;
                    }
                }
            }

            if (!(fnHandler instanceof Function)) {
                throw errorUtil.createError(
                    "Event handler '" + currentYlcEvent.strMethodName + "', " +
                    "specified for event '" + currentYlcEvent.strEventName + "', " +
                    "is not a function.",
                    domElement
                );
            }

            publicContext =
                createPublicContext(context, domView, domElement, controller);

            if (currentYlcEvent.strEventName === "ylcElementInitialized") {
                fnHandler.call(controller, context.getModel(), publicContext);
            }

            jqElement.bind(
                currentYlcEvent.strEventName,
                createHandler(context, publicContext, domView, controller, fnHandler, m2vOnly)
            );
        }

    }

    function createPublicContext(context, domView, domElement, controller) {
        var publicContext = {};

        publicContext.PREFIELD = PREFIELD;

        publicContext.domElement = domElement;
        publicContext.loopStatuses = context.getLoopStatusesSnapshot();
        publicContext.updateModel = function (fnUpdateMethod) {
            return callModelUpdatingMethod(
                context,
                publicContext,
                domView,
                controller,
                fnUpdateMethod
            );
        };

        return publicContext;
    }

    function m2vProcessElement(context, domView, domElement, controller, bBindEvents) {
        var nElementsProcessed;


        if (domTemplates.isTemplate(domElement)) {
            nElementsProcessed = m2vProcessDynamicElements(
                context,
                domView,
                $(domElement),
                controller
            );

        } else if (domElement !== domView && domAnnotator.isViewRoot($(domElement))) {
            nElementsProcessed = 1;

        } else {
            if (bBindEvents) {
                m2vBindEvents(context, domView, domElement, controller);
            }
            m2vSetValues(context, domElement);
            $(domElement).removeClass("ylcInvisibleTemplate");
            m2vProcessChildren(context, domView, domElement, controller, bBindEvents);

            nElementsProcessed = 1;
        }

        return nElementsProcessed;
    }

    return {
        createPublicContext: function(context, domView, domElement, controller) {
            return createPublicContext(context, domView, domElement, controller);
        },

        m2vProcessElement: function(context, domView, domElement, controller, bBindEvents) {
            return m2vProcessElement(context, domView, domElement, controller, bBindEvents);
        }
    }

}());