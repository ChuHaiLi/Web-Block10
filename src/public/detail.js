for (const section of document.querySelectorAll('.download-presets'))
{
    const tablist = section.querySelector('.preset-tabs');
    const tabs = Array.from(section.querySelectorAll('[role="tab"]'));
    const panels = Array.from(section.querySelectorAll('.preset-panel'));
    if (!tablist || tabs.length === 0 || tabs.length !== panels.length) continue;

    tablist.hidden = false;
    for (const title of section.querySelectorAll('.preset-group-title')) title.hidden = true;

    let activeIndex = 0;
    function selectTab(index, moveFocus)
    {
        activeIndex = index;
        tabs.forEach((tab, i) =>
        {
            const selected = i === index;
            tab.setAttribute('aria-selected', selected ? 'true' : 'false');
            tab.tabIndex = selected ? 0 : -1;
            panels[i].hidden = !selected;
        });
        if (moveFocus) tabs[index].focus();
    }

    selectTab(0, false);

    tabs.forEach((tab, index) =>
    {
        tab.addEventListener('click', () => selectTab(index, false));
    });

    tablist.addEventListener('keydown', event =>
    {
        let nextIndex;
        if (event.key === 'ArrowRight') nextIndex = (activeIndex + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (activeIndex - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else return;

        event.preventDefault();
        selectTab(nextIndex, true);
    });
}
